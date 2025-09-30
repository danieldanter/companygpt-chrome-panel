// shared/api-service.js - Simplified API layer
(function () {
  "use strict";

  const DEBUG = false;
  const debug = (...args) => {
    if (DEBUG) console.log("[APIService]", ...args);
  };

  // Simple API request helper
  async function apiRequest(domain, endpoint, options = {}) {
    if (!domain) throw new Error("No domain configured");

    const url = window.CONFIG.buildApiUrl(domain, endpoint);

    const response = await chrome.runtime.sendMessage({
      type: "API_REQUEST",
      data: {
        url,
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      },
    });

    if (!response.success) {
      throw new Error(response.error || "API request failed");
    }

    return response.data;
  }

  // Get current domain
  function getCurrentDomain() {
    return window.AuthService?.getActiveDomain() || null;
  }

  // Public API - simplified
  window.APIService = {
    async checkAuth() {
      return window.AuthService?.checkAuth() || false;
    },

    async fetchFolders() {
      const domain = getCurrentDomain();
      if (!domain) throw new Error("No domain configured");

      console.log(
        "[APIService] Fetching folders from:",
        `https://${domain}.506.ai/api/folders`
      );

      // Direct API call using chrome.runtime.sendMessage
      const response = await chrome.runtime.sendMessage({
        type: "API_REQUEST",
        data: {
          url: `https://${domain}.506.ai/api/folders`,
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
        },
      });

      console.log("[APIService] Folders response:", response);

      if (!response?.success) {
        throw new Error(response?.error || "Failed to fetch folders");
      }

      // Return the full data object which should contain { folders: [...] }
      return response.data;
    },

    async uploadAudio(folderId, filename, audioBlob) {
      if (!folderId || !audioBlob)
        throw new Error("Missing required parameters");

      const domain = getCurrentDomain();
      const reader = new FileReader();
      const base64data = await new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });

      return await apiRequest(domain, "UPLOAD_MEDIA", {
        method: "POST",
        body: { folderId, filename, audioData: base64data },
      });
    },

    async crawlUrl(folderId, url, title) {
      if (!folderId || !url) throw new Error("Missing required parameters");

      const domain = getCurrentDomain();
      return await apiRequest(domain, "CRAWL_URL", {
        method: "POST",
        body: { folderId, url, title },
      });
    },

    // ADD THIS NEW METHOD:
    // In shared/api-service.js, update the request method:

    async request(endpoint, options = {}) {
      const domain = getCurrentDomain();
      if (!domain) throw new Error("No domain configured - please login");

      // If it's already a path like "qr/chat", use it directly
      // Don't try to map it through CONFIG
      const url = `https://${domain}.506.ai/api/${endpoint}`;

      const response = await chrome.runtime.sendMessage({
        type: "API_REQUEST",
        data: {
          url,
          method: options.method || "GET",
          headers: {
            "Content-Type": "application/json",
            ...options.headers,
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        },
      });

      if (!response.success) {
        throw new Error(response.error || "API request failed");
      }

      return response.data;
    },

    // In shared/api-service.js, add these methods to window.APIService:

    async fetchRoles() {
      const domain = getCurrentDomain();
      if (!domain) throw new Error("No domain configured");

      const response = await chrome.runtime.sendMessage({
        type: "API_REQUEST",
        data: {
          url: `https://${domain}.506.ai/api/roles`,
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
        },
      });

      if (!response?.success) {
        throw new Error(response?.error || "Failed to fetch roles");
      }

      return response.data;
    },

    async sendChatMessage(payload) {
      const domain = getCurrentDomain();
      if (!domain) throw new Error("No domain configured");

      // Debug log
      console.log("[APIService] Sending chat payload:", payload);
      console.log("[APIService] Payload size:", JSON.stringify(payload).length);

      // Make sure we're sending the payload correctly
      const response = await chrome.runtime.sendMessage({
        type: "API_REQUEST",
        data: {
          url: `https://${domain}.506.ai/api/qr/chat`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
          body: JSON.stringify(payload), // Make sure this is stringified
        },
      });

      if (!response?.success) {
        throw new Error(response?.error || "API request failed");
      }

      return response.data;
    },

    openCompanyGPT() {
      const domain = getCurrentDomain();
      if (!domain) throw new Error("No domain configured");

      chrome.tabs.create({ url: window.CONFIG.buildUrl(domain) });
    },
  };
})();
