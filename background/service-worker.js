// background/service-worker.js
// Import shared config
//importScripts("../shared/config.js");

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
              // Inject content script if needed
              await chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                files: ["content/content-script.js"],
              });

              // Send message to content script
              const response = await chrome.tabs.sendMessage(activeTabId, {
                action: "getPageContext",
              });

              sendResponse(response);
            } catch (error) {
              debug("Failed to get page context:", error);
              sendResponse({
                success: false,
                error: error.message,
                // Fallback context
                title: "",
                url: "",
                selectedText: "",
                mainContent: "",
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

        // NEW: Injects a function into the active Google Docs tab that fetches the plain-text export and returns it.
        case "INJECT_GOOGLE_DOCS_EXTRACTOR": {
          const { tabId } = request.data;

          try {
            debug("Injecting Google Docs extractor into tab:", tabId);

            const results = await chrome.scripting.executeScript({
              target: { tabId },
              func: async () => {
                // Your exact working console code
                const match = location.href.match(/\/document\/d\/([^/]+)/);
                if (!match) return { success: false, error: "No doc ID found" };

                const docId = match[1];
                const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;

                try {
                  const response = await fetch(exportUrl);
                  if (!response.ok)
                    return { success: false, error: `HTTP ${response.status}` };

                  const text = await response.text();
                  console.log(
                    `Injected script extracted ${text.length} characters`
                  );

                  return {
                    success: true,
                    content: text,
                    length: text.length,
                  };
                } catch (error) {
                  return { success: false, error: error.message };
                }
              },
            });

            const result =
              Array.isArray(results) && results.length
                ? results[0].result
                : { success: false, error: "No result from injected script" };

            sendResponse(result);
          } catch (error) {
            console.error("Script injection failed:", error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        }

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
