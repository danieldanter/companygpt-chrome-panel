// background/service-worker.js

// Import shared modules (using your existing auth)
import "../shared/config.js";

// Store for active tab info
let activeTabId = null;

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  // Store the active tab
  activeTabId = tab.id;

  // Open the side panel
  await chrome.sidePanel.open({ tabId: tab.id });

  // Send tab info to side panel (with slight delay for panel to load)
  setTimeout(() => {
    chrome.runtime.sendMessage({
      type: "TAB_INFO",
      data: {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
      },
    });
  }, 100);
});

// Handle messages from content script and side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[Background] Received message:", request.type);

  switch (request.type) {
    case "GET_PAGE_CONTEXT":
      // Forward request to content script
      if (activeTabId) {
        chrome.tabs.sendMessage(
          activeTabId,
          {
            type: "EXTRACT_CONTEXT",
          },
          (response) => {
            sendResponse(response);
          }
        );
      }
      return true; // Keep channel open for async response

    case "CHECK_AUTH":
      // Reuse your existing auth check
      handleAuthCheck(sendResponse);
      return true;

    case "API_REQUEST":
      // Handle API requests (reuse your existing API service)
      handleAPIRequest(request.data, sendResponse);
      return true;

    default:
      console.log("[Background] Unknown message type:", request.type);
  }
});

// Auth check handler (integrate with your existing auth-service)
async function handleAuthCheck(sendResponse) {
  try {
    // This would connect to your existing auth logic
    const response = await checkCompanyGPTAuth();
    sendResponse({ success: true, isAuthenticated: response });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// API request handler
async function handleAPIRequest(data, sendResponse) {
  try {
    // Forward to your API service
    const response = await fetch(data.url, {
      method: data.method || "GET",
      headers: data.headers,
      body: data.body ? JSON.stringify(data.body) : undefined,
      credentials: "include",
    });

    const result = await response.json();
    sendResponse({ success: true, data: result });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// Keep service worker alive
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keepalive") {
    setTimeout(() => port.disconnect(), 250e3); // 4 minutes
    port.onDisconnect.addListener(() => {
      chrome.runtime.connect({ name: "keepalive" });
    });
  }
});

// Initialize keep-alive
chrome.runtime.connect({ name: "keepalive" });

console.log("[Background] Service worker initialized");
