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
      const data = await apiRequest(domain, "FOLDERS");
      return data.folders || [];
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

    openCompanyGPT() {
      const domain = getCurrentDomain();
      if (!domain) throw new Error("No domain configured");

      chrome.tabs.create({ url: window.CONFIG.buildUrl(domain) });
    },
  };
})();
