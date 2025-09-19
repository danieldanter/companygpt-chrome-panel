// content/content-script.js - Add guard at the very top
// Prevent multiple injections
// Improved guard that allows reinitialization when needed
(function () {
  // Check if already loaded AND still functional
  if (window.__companyGPTExtractorLoaded && window.__companyGPTExtractor) {
    console.log(
      "[CompanyGPT Extension] Content script already loaded and functional"
    );

    // Refresh the message listener for the existing instance
    if (window.__companyGPTExtractor.setupMessageListener) {
      window.__companyGPTExtractor.setupMessageListener();
    }
    return;
  }

  console.log("[CompanyGPT Extension] Content script initializing...");

  class ContentExtractor {
    constructor() {
      this.url = window.location.href;
      this.hostname = window.location.hostname;
      this.pathname = window.location.pathname;
      this.initialized = false;
      this.extractionCount = 0;
      this.lastExtraction = null;

      // Site-specific configurations
      this.siteConfig = this.detectSiteConfig();

      // Initialize
      this.init();
    }

    init() {
      // Mark as loaded for detection
      window.__companyGPTExtractorLoaded = true;

      // Set up message listener
      this.setupMessageListener();

      // Initialize site-specific features
      if (this.siteConfig.type !== "generic") {
        this.initializeSiteSpecific();
      }

      this.initialized = true;
      console.log(
        `[ContentExtractor] Initialized on ${this.hostname} (type: ${this.siteConfig.type})`
      );
    }

    detectSiteConfig() {
      // Detect site type and capabilities
      if (this.hostname.includes("docs.google.com")) {
        return {
          type: "google-docs",
          name: "Google Docs",
          capabilities: ["dom", "export-api"],
          selectors: {
            content: ".kix-page-content-wrapper",
            title: ".docs-title-input",
            pages: ".kix-page",
          },
        };
      } else if (this.hostname.includes("mail.google.com")) {
        return {
          type: "gmail",
          name: "Gmail",
          capabilities: ["dom", "dynamic"],
          selectors: {
            messages: 'div[role="listitem"]',
            subject: "h2[data-legacy-thread-id]",
            body: ".ii.gt .a3s.aiL",
            sender: "span[email]",
          },
        };
      } else if (
        this.hostname.includes("sharepoint.com") ||
        this.hostname.includes("office.com")
      ) {
        return {
          type: "sharepoint",
          name: "SharePoint/Office",
          capabilities: ["dom", "wopi"],
          selectors: {
            content: ".od-ItemContent-title",
            canvas: "#spPageCanvasContent",
            frame: 'iframe[name="WebApplicationFrame"]',
          },
        };
      } else if (this.hostname.includes("506.ai")) {
        return {
          type: "companygpt",
          name: "CompanyGPT",
          capabilities: ["dom"],
          selectors: {
            content: "main",
            chat: ".chat-message",
          },
        };
      } else {
        return {
          type: "generic",
          name: "Generic Site",
          capabilities: ["dom"],
          selectors: {
            content: 'article, main, [role="main"], .content, #content',
            headings: "h1, h2, h3",
            paragraphs: "p",
          },
        };
      }
    }

    // content/content-script.js - Update the setupMessageListener method

    setupMessageListener() {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // Add debug log for ALL messages
        console.log("[ContentExtractor] Received message:", request.action);

        // Handle Gmail-specific actions
        if (request.action === "INSERT_EMAIL_REPLY") {
          console.log(
            "[ContentExtractor] INSERT_EMAIL_REPLY received with data:",
            request.data
          );

          try {
            this.insertEmailReply(request.data);
            sendResponse({ success: true });
          } catch (error) {
            console.error(
              "[ContentExtractor] Error in insertEmailReply:",
              error
            );
            sendResponse({ success: false, error: error.message });
          }
          return true;
        }

        // Your existing message handling...
        const handleAsync = async () => {
          try {
            console.log(
              `[ContentExtractor] Processing action: ${request.action}`
            );

            switch (request.action) {
              case "ping":
                return { status: "ready", type: this.siteConfig.type };
              case "EXTRACT_CONTENT":
                return await this.extractContent(request.options);
              // ... rest of your cases
            }
          } catch (error) {
            console.error("[ContentExtractor] Error:", error);
            return { error: error.message };
          }
        };

        handleAsync().then(sendResponse);
        return true;
      });
    }

    // Add this new method to ContentExtractor class
    // content/content-script.js - Update the insertEmailReply method

    // content/content-script.js - Fix the insertEmailReply method

    insertEmailReply(emailData) {
      console.log("[ContentExtractor] Starting insertion process...");
      console.log("[ContentExtractor] Email data received:", emailData);

      // Click the reply button
      const replyButton =
        document.querySelector('[aria-label*="Reply"]') ||
        document.querySelector('[aria-label*="Antworten"]') ||
        document.querySelector('[data-tooltip*="Reply"]');

      if (replyButton) {
        console.log("[ContentExtractor] ✓ Found reply button:", replyButton);
        replyButton.click();
        console.log("[ContentExtractor] ✓ Clicked reply button");

        // Wait for compose area to appear
        setTimeout(() => {
          console.log("[ContentExtractor] Looking for compose area...");

          // Find the compose area
          const composeBody =
            document.querySelector(
              'div[role="textbox"][aria-label*="Message Body"]'
            ) ||
            document.querySelector('div[role="textbox"][g_editable="true"]') ||
            document.querySelector(
              'div[contenteditable="true"][aria-label*="Nachricht"]'
            );

          if (composeBody) {
            console.log(
              "[ContentExtractor] ✓ Found compose body:",
              composeBody
            );

            // Clean up the email content
            let cleanedBody = emailData.body;

            // Remove Subject line if it exists
            cleanedBody = cleanedBody.replace(/^Subject:.*?\n+/i, "");

            // Remove quotes if wrapped
            if (cleanedBody.startsWith('"') && cleanedBody.endsWith('"')) {
              cleanedBody = cleanedBody.slice(1, -1);
            }

            console.log(
              "[ContentExtractor] Cleaned body:",
              cleanedBody.substring(0, 100) + "..."
            );

            // Convert newlines to HTML breaks
            cleanedBody = cleanedBody.replace(
              /\n\n+/g,
              "</div><div><br></div><div>"
            );
            cleanedBody = cleanedBody.replace(/\n/g, "</div><div>");
            cleanedBody = "<div>" + cleanedBody + "</div>";
            cleanedBody = cleanedBody.replace(/^(<div><\/div>)+/, "");

            console.log("[ContentExtractor] Setting innerHTML...");

            // Set the HTML content
            const oldContent = composeBody.innerHTML;
            composeBody.innerHTML = cleanedBody;

            console.log(
              "[ContentExtractor] Old content length:",
              oldContent.length
            );
            console.log(
              "[ContentExtractor] New content length:",
              composeBody.innerHTML.length
            );
            console.log(
              "[ContentExtractor] Content actually changed:",
              oldContent !== composeBody.innerHTML
            );

            // Trigger input event so Gmail recognizes the change
            composeBody.dispatchEvent(new Event("input", { bubbles: true }));

            // Visual feedback
            composeBody.style.backgroundColor = "#ffffcc";
            setTimeout(() => {
              composeBody.style.backgroundColor = "";
              console.log("[ContentExtractor] Visual feedback completed");
            }, 2000);

            console.log("[ContentExtractor] ✓ Email reply insertion completed");
          } else {
            console.error("[ContentExtractor] ✗ Could not find compose body");
            console.log(
              "[ContentExtractor] Available textboxes:",
              document.querySelectorAll('div[role="textbox"]')
            );
            console.log(
              "[ContentExtractor] Available contenteditable:",
              document.querySelectorAll('div[contenteditable="true"]')
            );
          }
        }, 1000);
      } else {
        console.error("[ContentExtractor] ✗ Could not find reply button");
        console.log(
          "[ContentExtractor] Buttons with Reply in aria-label:",
          document.querySelectorAll(
            '[aria-label*="Reply"], [aria-label*="Antworten"]'
          )
        );
      }

      // Always return success (bad practice but that's what we have)
      return { success: true };
    }
    async extractContent(options = {}) {
      this.extractionCount++;
      const startTime = performance.now();

      console.log(
        `[ContentExtractor] Starting extraction #${this.extractionCount}`
      );

      let result = {
        url: this.url,
        title: document.title,
        hostname: this.hostname,
        siteType: this.siteConfig.type,
        timestamp: Date.now(),
        extractionNumber: this.extractionCount,
        success: false,
        content: "",
        metadata: {},
      };

      try {
        // Route to appropriate extractor
        switch (this.siteConfig.type) {
          case "google-docs":
            result = { ...result, ...(await this.extractGoogleDocs()) };
            break;

          case "gmail":
            result = { ...result, ...this.extractGmail() };
            break;

          case "sharepoint":
            result = { ...result, ...(await this.extractSharePoint()) };
            break;

          case "companygpt":
            result = { ...result, ...this.extractCompanyGPT() };
            break;

          default:
            result = { ...result, ...this.extractGeneric() };
        }

        result.success = true;
      } catch (error) {
        console.error("[ContentExtractor] Extraction error:", error);
        result.error = error.message;
      }

      const extractionTime = performance.now() - startTime;
      result.metadata.extractionTime = extractionTime;

      console.log(
        `[ContentExtractor] Extraction completed in ${extractionTime.toFixed(
          2
        )}ms`
      );

      // Cache the result
      this.lastExtraction = result;

      return result;
    }

    async extractGoogleDocs() {
      console.log("[ContentExtractor] Extracting Google Docs content...");

      // First try DOM extraction
      const pages = document.querySelectorAll(
        this.siteConfig.selectors.content
      );
      let content = "";

      pages.forEach((page, index) => {
        const pageText = page.innerText.trim();
        if (pageText) {
          content += `\n--- Page ${index + 1} ---\n${pageText}\n`;
        }
      });

      // Get document ID for potential export
      const docId = this.pathname.match(/\/document\/d\/([^/]+)/)?.[1];

      // Check if we have enough content from DOM
      if (content.length > 100) {
        return {
          content,
          metadata: {
            method: "dom-extraction",
            pageCount: pages.length,
            docId,
            length: content.length,
          },
        };
      } else {
        // Need to use export API - signal to background script
        return {
          content: content || "Document appears empty or requires export API",
          metadata: {
            method: "dom-partial",
            needsExport: true,
            docId,
            exportUrl: `/document/d/${docId}/export?format=txt`,
          },
        };
      }
    }

    extractGmail() {
      console.log("[ContentExtractor] Extracting Gmail content...");

      const messages = [];
      const selectedText = window.getSelection().toString();

      // Get email subject
      const subject =
        document.querySelector(this.siteConfig.selectors.subject)?.innerText ||
        "";

      // Extract all messages in the thread
      document
        .querySelectorAll(this.siteConfig.selectors.messages)
        .forEach((msgEl, index) => {
          const sender =
            msgEl
              .querySelector(this.siteConfig.selectors.sender)
              ?.getAttribute("email") ||
            msgEl.querySelector(".gD")?.getAttribute("email") ||
            msgEl.querySelector(".go")?.innerText ||
            "Unknown sender";

          const timestamp =
            msgEl.querySelector(".g3")?.getAttribute("title") ||
            msgEl.querySelector("[title]")?.getAttribute("title") ||
            "";

          const bodyEl =
            msgEl.querySelector(this.siteConfig.selectors.body) ||
            msgEl.querySelector(".a3s") ||
            msgEl.querySelector('[dir="ltr"]');

          const body = bodyEl?.innerText || "";

          if (body) {
            messages.push({
              index: index + 1,
              sender,
              timestamp,
              body: body.trim(),
            });
          }
        });

      // Format messages for output
      let formattedContent = "";

      if (subject) {
        formattedContent += `Subject: ${subject}\n\n`;
      }

      if (messages.length > 0) {
        formattedContent += `Email Thread (${messages.length} messages):\n\n`;

        messages.forEach((msg) => {
          formattedContent += `--- Message ${msg.index} ---\n`;
          formattedContent += `From: ${msg.sender}\n`;
          if (msg.timestamp) formattedContent += `Time: ${msg.timestamp}\n`;
          formattedContent += `\n${msg.body}\n\n`;
        });
      } else {
        formattedContent +=
          "No email content found. The conversation may still be loading.";
      }

      return {
        content: formattedContent,
        selectedText,
        siteType: "gmail", // Make sure this is set
        metadata: {
          method: "gmail-extraction",
          messageCount: messages.length,
          hasSubject: !!subject,
          isGmail: true, // Add this explicitly
          messages: messages.map((m) => ({
            sender: m.sender,
            timestamp: m.timestamp,
            bodyLength: m.body.length,
          })),
        },
      };
    }

    async extractSharePoint() {
      console.log("[ContentExtractor] Extracting SharePoint content...");

      // Check for document viewer
      const isDocumentViewer =
        this.url.includes("_layouts/15/Doc.aspx") ||
        this.url.includes("_layouts/15/WopiFrame");

      if (isDocumentViewer) {
        // Try to get document info
        const urlParams = new URLSearchParams(window.location.search);
        const sourceDoc = urlParams.get("sourcedoc");
        const fileName = document.title.replace(" - SharePoint", "").trim();

        // Check for Office Online frame
        const frame = document.querySelector(this.siteConfig.selectors.frame);

        return {
          content: `SharePoint Document: ${fileName}`,
          metadata: {
            method: "sharepoint-viewer",
            isDocument: true,
            needsApiExtraction: true,
            sourceDoc,
            fileName,
            hasFrame: !!frame,
            documentUrl: this.url,
          },
        };
      }

      // Regular SharePoint page
      const pageContent =
        document.querySelector(this.siteConfig.selectors.canvas)?.innerText ||
        document.querySelector(".od-ItemContent")?.innerText ||
        document.querySelector('[role="main"]')?.innerText ||
        "";

      return {
        content: pageContent,
        metadata: {
          method: "sharepoint-page",
          contentLength: pageContent.length,
        },
      };
    }

    extractCompanyGPT() {
      console.log("[ContentExtractor] Extracting CompanyGPT content...");

      // Extract chat messages if present
      const messages = [];
      document
        .querySelectorAll(this.siteConfig.selectors.chat)
        .forEach((msgEl) => {
          const role = msgEl.classList.contains("user") ? "user" : "assistant";
          const content = msgEl.innerText;
          messages.push({ role, content });
        });

      // Get main content
      const mainContent =
        document.querySelector(this.siteConfig.selectors.content)?.innerText ||
        "";

      return {
        content: mainContent,
        metadata: {
          method: "companygpt-extraction",
          hasChat: messages.length > 0,
          messageCount: messages.length,
          messages: messages.slice(-10), // Last 10 messages
        },
      };
    }

    extractGeneric() {
      console.log("[ContentExtractor] Extracting generic content...");

      const selectedText = window.getSelection().toString();

      // Try multiple strategies
      let content = "";

      // Strategy 1: Look for main content areas
      const contentSelectors = this.siteConfig.selectors.content.split(", ");
      for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && element.innerText.length > 100) {
          content = element.innerText;
          break;
        }
      }

      // Strategy 2: Get largest text block if no main content found
      if (!content) {
        const allTextBlocks = document.querySelectorAll(
          "div, section, article"
        );
        let largestBlock = "";
        let largestLength = 0;

        allTextBlocks.forEach((block) => {
          const text = block.innerText || "";
          if (text.length > largestLength && text.length < 50000) {
            // Cap at 50k chars
            largestLength = text.length;
            largestBlock = text;
          }
        });

        content = largestBlock;
      }

      // Strategy 3: Fallback to body text
      if (!content || content.length < 100) {
        content = document.body.innerText || "";
      }

      // Truncate if too long
      const maxLength = 10000;
      if (content.length > maxLength) {
        content =
          content.substring(0, maxLength) + "\n\n[... Content truncated ...]";
      }

      return {
        content,
        selectedText,
        metadata: {
          method: "generic-extraction",
          contentLength: content.length,
          hasSelectedText: !!selectedText,
        },
      };
    }

    // Site-specific initialization
    initializeSiteSpecific() {
      switch (this.siteConfig.type) {
        case "gmail":
          this.initGmailObserver();
          break;
        case "google-docs":
          this.initDocsObserver();
          break;
        case "sharepoint":
          this.initSharePointObserver();
          break;
      }
    }

    initGmailObserver() {
      // Watch for new emails being loaded
      const observer = new MutationObserver((mutations) => {
        // Check if new messages appeared
        const hasNewMessages = mutations.some((mutation) => {
          return Array.from(mutation.addedNodes).some((node) => {
            return (
              node.nodeType === 1 &&
              (node.matches?.('[role="listitem"]') ||
                node.querySelector?.('[role="listitem"]'))
            );
          });
        });

        if (hasNewMessages) {
          console.log("[ContentExtractor] New Gmail messages detected");
          // Could notify extension that new content is available
          chrome.runtime
            .sendMessage({
              type: "CONTENT_UPDATED",
              siteType: "gmail",
              url: this.url,
            })
            .catch(() => {}); // Ignore errors if extension context not available
        }
      });

      const container = document.querySelector('.AO, [role="main"]');
      if (container) {
        observer.observe(container, {
          childList: true,
          subtree: true,
        });
        console.log("[ContentExtractor] Gmail observer initialized");
      }
    }

    initDocsObserver() {
      // Watch for document changes
      let lastContent = "";

      const checkForChanges = () => {
        const currentContent =
          document.querySelector(".kix-page")?.innerText || "";
        if (currentContent !== lastContent) {
          lastContent = currentContent;
          console.log("[ContentExtractor] Google Docs content changed");
          // Debounced notification
          clearTimeout(this.docsChangeTimeout);
          this.docsChangeTimeout = setTimeout(() => {
            chrome.runtime
              .sendMessage({
                type: "CONTENT_UPDATED",
                siteType: "google-docs",
                url: this.url,
              })
              .catch(() => {});
          }, 1000);
        }
      };

      // Check periodically (Google Docs doesn't trigger mutations reliably)
      setInterval(checkForChanges, 5000);
    }

    initSharePointObserver() {
      // Watch for SharePoint dynamic content loading
      const observer = new MutationObserver((mutations) => {
        const hasNewContent = mutations.some((mutation) => {
          return (
            mutation.target.id === "spPageCanvasContent" ||
            mutation.target.classList?.contains("od-ItemContent")
          );
        });

        if (hasNewContent) {
          console.log("[ContentExtractor] SharePoint content updated");
        }
      });

      const container = document.querySelector(
        "#spPageCanvasContent, .od-ItemContent"
      );
      if (container) {
        observer.observe(container, {
          childList: true,
          subtree: true,
        });
      }
    }
  }

  // Initialize the extractor
  let contentExtractor = null;

  function initializeExtractor() {
    if (contentExtractor) {
      console.log("[ContentExtractor] Already initialized");
      return;
    }

    contentExtractor = new ContentExtractor();

    // Handle SPA navigation
    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        console.log("[ContentExtractor] URL changed, reinitializing...");
        contentExtractor = new ContentExtractor();
      }
    }).observe(document, { subtree: true, childList: true });
  }

  // Initialize based on document state
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeExtractor);
  } else {
    initializeExtractor();
  }

  // Store the instance globally for reuse
  window.__companyGPTExtractor = new ContentExtractor();
  window.__companyGPTExtractorLoaded = true;

  console.log("[CompanyGPT Extension] Content script loaded");
})(); // End of IIFE
