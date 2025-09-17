// background/service-worker.js
// Import shared config
//importScripts("../shared/config.js");
// Import mammoth for Word document extraction
importScripts("../libs/mammoth.browser.min.js");
importScripts("../libs/pdf.min.js");

// Debug flag
const DEBUG = true;
const debug = (...args) => {
  if (DEBUG) console.log("[Background]", ...args);
};

// Auth cache
const authCache = {
  isAuthenticated: null,
  lastCheck: 0,
  TTL: 30000, // 30 seconds
  activeDomain: null,
  hasMultipleDomains: false,
  availableDomains: [],
};

// Store for active tab info
let activeTabId = null;

/**
 * Detects the active domain from cookies
 */
async function detectActiveDomain() {
  try {
    const COOKIE_NAME = "__Secure-next-auth.session-token";

    const cookies = await chrome.cookies.getAll({
      domain: ".506.ai",
      name: COOKIE_NAME,
    });

    if (!cookies || cookies.length === 0) {
      debug("No cookies found");
      return { domain: null, hasMultiple: false, availableDomains: [] };
    }

    // Sort by most recent access/expiration
    cookies.sort((a, b) => {
      const timeA = a.lastAccessed || a.expirationDate || 0;
      const timeB = b.lastAccessed || b.expirationDate || 0;
      return timeB - timeA;
    });

    // Extract unique subdomains
    const domains = cookies
      .map((cookie) => cookie.domain.replace(/^\./, "").replace(".506.ai", ""))
      .map((d) => d.trim())
      .filter(Boolean);

    const uniqueDomains = [...new Set(domains)];
    const activeDomain = domains[0] || null;

    debug(`Active domain: ${activeDomain}`);
    debug(`Available domains: ${uniqueDomains.join(", ")}`);

    return {
      domain: activeDomain,
      hasMultiple: uniqueDomains.length > 1,
      availableDomains: uniqueDomains,
    };
  } catch (error) {
    console.error("Domain detection failed:", error);
    return { domain: null, hasMultiple: false, availableDomains: [] };
  }
}

/**
 * Checks authentication
 */
async function checkCompanyGPTAuth(skipCache = false) {
  if (!skipCache && authCache.isAuthenticated !== null) {
    if (Date.now() - authCache.lastCheck < authCache.TTL) {
      debug(`Auth cache hit - Domain: ${authCache.activeDomain}`);
      return authCache.isAuthenticated;
    }
  }

  try {
    const domainInfo = await detectActiveDomain();

    if (!domainInfo.domain) {
      debug("No active domain found");
      authCache.isAuthenticated = false;
      authCache.lastCheck = Date.now();
      authCache.activeDomain = null;
      authCache.hasMultipleDomains = false;
      authCache.availableDomains = [];
      return false;
    }

    authCache.activeDomain = domainInfo.domain;
    authCache.hasMultipleDomains = domainInfo.hasMultiple;
    authCache.availableDomains = domainInfo.availableDomains;

    await chrome.storage.local.set({ lastKnownDomain: domainInfo.domain });

    const cookie = await chrome.cookies.get({
      url: `https://${domainInfo.domain}.506.ai`,
      name: "__Secure-next-auth.session-token",
    });

    authCache.isAuthenticated = !!cookie;
    authCache.lastCheck = Date.now();

    debug(
      `Auth check complete - Domain: ${domainInfo.domain}, Auth: ${authCache.isAuthenticated}`
    );

    return authCache.isAuthenticated;
  } catch (error) {
    console.error("Auth check failed:", error);
    authCache.isAuthenticated = false;
    authCache.lastCheck = Date.now();
    return false;
  }
}

/**
 * Handle API requests with proper credentials
 */
async function handleAPIRequest(data) {
  debug("API Request:", data.url);
  debug("Method:", data.method);
  debug("Body:", data.body);

  try {
    const options = {
      method: data.method || "GET",
      headers: data.headers || {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include", // Important for cookies!
    };

    // Add body if provided
    if (data.body && data.method !== "GET") {
      options.body = data.body;
    }

    debug("Fetch options:", options);

    const response = await fetch(data.url, options);

    debug("Response status:", response.status);
    debug("Response headers:", response.headers);

    if (!response.ok) {
      const errorText = await response.text();
      debug("Error response:", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    // Try to parse as JSON first
    const text = await response.text();
    debug("Response text:", text);

    try {
      const json = JSON.parse(text);
      debug("Parsed JSON:", json);
      return { success: true, data: json };
    } catch {
      // Return as plain text if not JSON
      debug("Returning as plain text");
      return { success: true, data: text };
    }
  } catch (error) {
    console.error("API request failed:", error);
    return { success: false, error: error.message };
  }
}

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  debug("Extension icon clicked");

  activeTabId = tab.id;
  await chrome.sidePanel.open({ tabId: tab.id });

  setTimeout(() => {
    chrome.runtime
      .sendMessage({
        type: "TAB_INFO",
        data: {
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
        },
      })
      .catch(() => {
        // Panel might not be ready
      });
  }, 100);
});

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debug("Received message:", request.type || request.action);

  (async () => {
    try {
      const action = request.type || request.action;

      switch (action) {
        case "CHECK_AUTH":
        case "checkAuth": {
          const isAuthenticated = await checkCompanyGPTAuth(request.skipCache);
          sendResponse({
            success: true,
            isAuthenticated,
            domain: authCache.activeDomain,
            hasMultipleDomains: authCache.hasMultipleDomains,
            availableDomains: authCache.availableDomains,
          });
          break;
        }

        case "GET_PAGE_CONTEXT": {
          if (activeTabId) {
            try {
              // Try content script first
              const response = await chrome.tabs.sendMessage(activeTabId, {
                action: "EXTRACT_CONTENT",
              });

              sendResponse(response);
            } catch (error) {
              // Content script not available
              debug("Content script not available:", error);
              sendResponse({
                success: false,
                error:
                  "Content script not loaded. Click 'Load Context' button to extract.",
              });
            }
          } else {
            sendResponse({ success: false, error: "No active tab" });
          }
          break;
        }

        case "API_REQUEST": {
          const result = await handleAPIRequest(request.data);
          sendResponse(result);
          break;
        }

        // Extract Google Docs content by calling its export endpoint directly from the SW (uses browser cookies).
        case "EXTRACT_GOOGLE_DOCS": {
          const { docId } = request.data;

          try {
            debug("Extracting Google Docs content for:", docId);

            const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
            debug("Fetching from:", exportUrl);

            const response = await fetch(exportUrl, {
              method: "GET",
              credentials: "include", // Use cookies from browser
            });

            if (!response.ok) {
              throw new Error(
                `HTTP ${response.status}: ${response.statusText}`
              );
            }

            const textContent = await response.text();

            debug(
              `Google Docs extraction successful: ${textContent.length} characters`
            );
            debug("Content preview:", textContent.substring(0, 200) + "...");

            sendResponse({
              success: true,
              content: textContent,
              length: textContent.length,
            });
          } catch (error) {
            console.error("Google Docs extraction failed:", error);
            sendResponse({
              success: false,
              error: error.message,
            });
          }
          break;
        }

        case "EXTRACT_SHAREPOINT_DOCUMENT": {
          const { sourceDoc, fileUrl, siteUrl } = request.data;

          try {
            console.log("[Background] Extracting SharePoint document...");

            // Get the WOPI context from the page
            const [tab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });

            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const scripts = document.querySelectorAll("script");
                for (const script of scripts) {
                  if (script.textContent.includes("wopiContextJson")) {
                    const match = script.textContent.match(
                      /wopiContextJson\s*=\s*({[\s\S]*?});/
                    );
                    if (match) {
                      try {
                        const wopiContext = JSON.parse(match[1]);
                        return {
                          success: true,
                          fileGetUrl: wopiContext.FileGetUrl,
                          fileName: wopiContext.FileName,
                          fileSize: wopiContext.FileSize,
                        };
                      } catch (e) {
                        console.error("Failed to parse WOPI context:", e);
                      }
                    }
                  }
                }
                return { success: false };
              },
            });

            if (
              results &&
              results[0]?.result?.success &&
              results[0].result.fileGetUrl
            ) {
              const { fileGetUrl, fileName } = results[0].result;

              console.log(
                "[Background] Downloading document from:",
                fileGetUrl
              );

              // Download the actual file
              const downloadResponse = await fetch(fileGetUrl, {
                method: "GET",
                credentials: "include",
              });

              if (downloadResponse.ok) {
                const blob = await downloadResponse.blob();
                console.log(
                  "[Background] Downloaded:",
                  fileName,
                  "-",
                  blob.size,
                  "bytes, type:",
                  blob.type
                );

                // Handle different file types

                // 1. TEXT FILES (.txt, .csv, .log, etc.)
                if (
                  fileName.match(
                    /\.(txt|text|csv|log|md|markdown|json|xml|html|htm|js|css|py|java|cpp|c|h|sh|bat|ps1|yaml|yml)$/i
                  ) ||
                  blob.type.includes("text/")
                ) {
                  console.log(
                    "[Background] Text file detected, reading directly..."
                  );
                  const text = await blob.text();
                  sendResponse({
                    success: true,
                    content: text,
                    method: "direct text file",
                    fileType: fileName.split(".").pop(),
                  });
                  return;
                }

                // 2. WORD DOCUMENTS (.docx, .doc)
                if (
                  fileName.match(/\.(docx|doc)$/i) ||
                  blob.type.includes("officedocument.wordprocessing")
                ) {
                  console.log(
                    "[Background] Word document detected, using mammoth..."
                  );

                  const arrayBuffer = await blob.arrayBuffer();

                  mammoth
                    .extractRawText({ arrayBuffer: arrayBuffer })
                    .then(function (result) {
                      console.log(
                        "[Background] Mammoth extraction successful!"
                      );
                      sendResponse({
                        success: true,
                        content: result.value,
                        method: "mammoth extraction",
                        fileType: "word",
                      });
                    })
                    .catch(function (err) {
                      console.error(
                        "[Background] Mammoth extraction failed:",
                        err
                      );
                      sendResponse({
                        success: false,
                        error:
                          "Failed to extract Word document: " + err.message,
                      });
                    });

                  return true; // Keep channel open for async response
                }

                // 3. POWERPOINT FILES (.pptx, .ppt)
                if (
                  fileName.match(/\.(pptx|ppt)$/i) ||
                  blob.type.includes("officedocument.presentation")
                ) {
                  console.log(
                    "[Background] PowerPoint detected, extracting text..."
                  );

                  // PowerPoint files are actually ZIP archives with XML inside
                  // We need a different approach - basic text extraction

                  try {
                    // Convert to array buffer
                    const arrayBuffer = await blob.arrayBuffer();

                    // Basic text extraction from PowerPoint
                    // This is a simple approach - just find readable text in the binary
                    const uint8Array = new Uint8Array(arrayBuffer);
                    const decoder = new TextDecoder("utf-8", { fatal: false });

                    // Look for text content in the file
                    let extractedText = "";
                    const chunkSize = 1000000; // 1MB chunks

                    for (let i = 0; i < uint8Array.length; i += chunkSize) {
                      const chunk = uint8Array.slice(
                        i,
                        Math.min(i + chunkSize, uint8Array.length)
                      );
                      const decodedChunk = decoder.decode(chunk);

                      // Extract readable text (basic approach)
                      const readableText =
                        decodedChunk.match(/[\x20-\x7E\s]{10,}/g);
                      if (readableText) {
                        extractedText += readableText
                          .filter((text) => {
                            // Filter out XML tags and other noise
                            return (
                              !text.includes("<") &&
                              !text.includes(">") &&
                              text.trim().length > 10
                            );
                          })
                          .join("\n");
                      }
                    }

                    if (extractedText.trim()) {
                      sendResponse({
                        success: true,
                        content:
                          `PowerPoint Presentation: ${fileName}\n\n` +
                          `Extracted Text Content:\n${extractedText}\n\n` +
                          `Note: This is a basic text extraction. Some formatting and structure may be lost.`,
                        method: "basic PowerPoint extraction",
                        fileType: "powerpoint",
                      });
                    } else {
                      // If basic extraction fails, provide instructions
                      sendResponse({
                        success: true,
                        content:
                          `PowerPoint file "${fileName}" detected (${blob.size} bytes).\n\n` +
                          `The presentation could not be automatically extracted.\n\n` +
                          `To share the content:\n` +
                          `1. Open the presentation in PowerPoint Online\n` +
                          `2. Switch to "Outline View" if available\n` +
                          `3. Select all text (Ctrl+A)\n` +
                          `4. Copy and paste it here\n\n` +
                          `Alternatively, you can export the presentation as PDF and try again.`,
                        method: "manual required for PowerPoint",
                        fileType: "powerpoint",
                      });
                    }
                  } catch (err) {
                    console.error(
                      "[Background] PowerPoint extraction error:",
                      err
                    );
                    sendResponse({
                      success: true,
                      content:
                        `PowerPoint file "${fileName}" requires manual extraction.\n` +
                        `Please copy the slide content from PowerPoint Online and paste it here.`,
                      method: "PowerPoint extraction failed",
                    });
                  }

                  return;
                }

                // 4. PDF FILES
                // 4. PDF FILES
                if (fileName.match(/\.pdf$/i) || blob.type.includes("pdf")) {
                  console.log("[Background] PDF detected, extracting text...");

                  try {
                    const arrayBuffer = await blob.arrayBuffer();

                    // Load the PDF document
                    const loadingTask = pdfjsLib.getDocument({
                      data: arrayBuffer,
                    });
                    const pdf = await loadingTask.promise;

                    console.log(
                      `[Background] PDF loaded: ${pdf.numPages} pages`
                    );

                    let fullText = "";

                    // Extract text from each page
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                      const page = await pdf.getPage(pageNum);
                      const textContent = await page.getTextContent();

                      // Combine text items from the page
                      const pageText = textContent.items
                        .map((item) => item.str)
                        .join(" ");

                      fullText += `\n--- Page ${pageNum} ---\n${pageText}\n`;
                    }

                    if (fullText.trim()) {
                      sendResponse({
                        success: true,
                        content:
                          `PDF Document: ${fileName}\n` +
                          `Pages: ${pdf.numPages}\n\n` +
                          `Content:\n${fullText}`,
                        method: "PDF.js extraction",
                        fileType: "pdf",
                      });
                    } else {
                      // PDF might be scanned/image-based
                      sendResponse({
                        success: true,
                        content:
                          `PDF Document: ${fileName} (${pdf.numPages} pages)\n\n` +
                          `This appears to be a scanned PDF or contains only images.\n` +
                          `Text extraction is not possible for image-based PDFs.\n\n` +
                          `To share the content:\n` +
                          `1. Open the PDF in SharePoint\n` +
                          `2. Use OCR software if it's a scanned document\n` +
                          `3. Or manually type the relevant content`,
                        method: "PDF no text content",
                        fileType: "pdf",
                      });
                    }
                  } catch (err) {
                    console.error("[Background] PDF extraction error:", err);
                    sendResponse({
                      success: true,
                      content:
                        `PDF "${fileName}" could not be extracted.\nError: ${err.message}\n\n` +
                        `Please copy the text manually from the PDF viewer.`,
                      method: "PDF extraction failed",
                    });
                  }

                  return;
                }

                // 5. EXCEL FILES
                if (
                  fileName.match(/\.(xlsx|xls|csv)$/i) ||
                  blob.type.includes("spreadsheet")
                ) {
                  console.log("[Background] Excel/CSV detected");

                  if (fileName.endsWith(".csv")) {
                    // CSV is just text, read it directly
                    const text = await blob.text();
                    sendResponse({
                      success: true,
                      content: `CSV File: ${fileName}\n\n${text}`,
                      method: "direct CSV read",
                      fileType: "csv",
                    });
                    return;
                  }

                  // Excel files need special handling
                  sendResponse({
                    success: true,
                    content:
                      `Excel file: ${fileName} (${blob.size} bytes)\n\n` +
                      `To share Excel data:\n` +
                      `1. Open in Excel Online\n` +
                      `2. Select the cells you want to share\n` +
                      `3. Copy (Ctrl+C) and paste here\n\n` +
                      `The data will be pasted as a table format.`,
                    method: "Excel manual extraction",
                    fileType: "excel",
                  });
                  return;
                }

                // Unknown file type
                sendResponse({
                  success: true,
                  content:
                    `File "${fileName}" downloaded (${blob.size} bytes).\n` +
                    `File type: ${blob.type || "Unknown"}\n\n` +
                    `This file type is not directly supported. Please open it in SharePoint and copy the content manually.`,
                  metadata: {
                    hasFile: true,
                    fileSize: blob.size,
                    fileName: fileName,
                    fileType: blob.type,
                  },
                  method: "unsupported type",
                });
                return;
              }
            }

            // Fallback
            sendResponse({
              success: true,
              content: `SharePoint document detected. Please copy and paste the content from the document viewer.`,
              method: "manual required",
            });
          } catch (error) {
            console.error("[Background] SharePoint extraction error:", error);
            sendResponse({
              success: false,
              error: error.message,
            });
          }
          break;
        }

        // NEW: Injects a function into the active Google Docs tab that fetches the plain-text export and returns it.

        default:
          debug("Unknown action:", action);
          sendResponse({ success: false, error: "Unknown action" });
      }
    } catch (error) {
      console.error(`Error handling ${request.type}:`, error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep channel open
});

// Watch for cookie changes
let cookieDebounceTimer = null;
chrome.cookies.onChanged.addListener((changeInfo) => {
  try {
    const c = changeInfo.cookie;

    if (!c || c.name !== "__Secure-next-auth.session-token") return;
    if (!/\.506\.ai$/.test(c.domain)) return;

    if (cookieDebounceTimer) clearTimeout(cookieDebounceTimer);

    cookieDebounceTimer = setTimeout(async () => {
      const info = await detectActiveDomain();

      authCache.activeDomain = info.domain;
      authCache.hasMultipleDomains = info.hasMultiple;
      authCache.availableDomains = info.availableDomains;
      authCache.lastCheck = 0;

      await chrome.storage.local.set({ lastKnownDomain: info.domain || null });

      chrome.runtime
        .sendMessage({
          type: "AUTH_STATE_CHANGED",
          domain: info.domain,
          hasMultipleDomains: info.hasMultiple,
          availableDomains: info.availableDomains,
        })
        .catch(() => {});

      debug("Cookie changed, domain updated:", info.domain);
    }, 300);
  } catch (e) {
    console.error("Cookie change handler error:", e);
  }
});

console.log("[Background] Service worker initialized with API support");
