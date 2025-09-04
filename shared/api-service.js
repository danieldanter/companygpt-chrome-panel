// popup/services/api-service.js
// CompanyGPT API communication service (MV3-safe)
/* eslint-disable no-undef */
(function () {
  "use strict";

  // Toggle verbose logs for development (true locally; false for store)
  const DEBUG = false;
  const debug = (...args) => {
    if (DEBUG) console.log(...args);
  };

  /**
   * Send a message to the background script.
   * Uses window.ChromeAPI if provided, otherwise falls back to chrome.runtime.
   * @param {string} action
   * @param {object} [data]
   * @returns {Promise<any>}
   */
  const sendMessage = (action, data = {}) => {
    if (window.ChromeAPI?.sendMessage) {
      return window.ChromeAPI.sendMessage(action, data);
    }
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  };

  /**
   * Check if user is authenticated with CompanyGPT.
   * Delegates to AuthService (single source of truth).
   */
  async function checkAuthentication() {
    return window.AuthService.checkAuth();
  }

  /**
   * Fetch available folders.
   * @returns {Promise<Array>}
   */
  async function fetchFolders() {
    try {
      debug("[APIService] Fetching folders...");

      // Pre-check auth using AuthService
      if (!window.AuthService.isAuthenticated()) {
        throw new Error("Not authenticated");
      }

      const response = await sendMessage("fetchFolders");

      if (response && response.success) {
        let folders = response.folders;
        if (response.folders && response.folders.folders) {
          folders = response.folders.folders;
        }
        debug("[APIService] Fetched", folders?.length || 0, "folders");
        return folders || [];
      }

      // Handle 401 - let AuthService manage state
      if (response?.error?.includes("401")) {
        debug("[APIService] Got 401 - session expired");
        window.AuthService.logout();
        throw new Error("Session expired - please login again");
      }

      throw new Error(response?.error || "Failed to fetch folders");
    } catch (error) {
      console.error("[APIService] Fetch folders failed:", error);

      if (error.message?.includes("401")) {
        window.AuthService.logout();
      }
      throw error;
    }
  }

  /**
   * Upload audio file to CompanyGPT.
   * @param {string} folderId
   * @param {string} filename
   * @param {Blob} audioBlob
   * @returns {Promise<any>}
   */
  async function uploadAudio(folderId, filename, audioBlob) {
    if (!folderId) throw new Error("No folder selected");
    if (!audioBlob) throw new Error("No audio data to upload");

    try {
      debug("[APIService] Uploading audio:", filename, "to folder:", folderId);

      // Convert blob to base64 data URL
      const reader = new FileReader();
      const base64data = await new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });

      const response = await sendMessage("uploadWithAuth", {
        data: { folderId, filename, audioData: base64data },
      });

      if (response && response.success) {
        debug("[APIService] Upload successful");
        return response;
      }

      throw new Error(response?.error || "Upload failed");
    } catch (error) {
      console.error("[APIService] Upload failed:", error);
      throw error;
    }
  }

  /**
   * Submit URL for crawling.
   * @param {string} folderId
   * @param {string} url
   * @param {string} [title]
   * @returns {Promise<any>}
   */
  async function crawlUrl(folderId, url, title) {
    if (!folderId) throw new Error("No folder selected");
    if (!url) throw new Error("No URL provided");

    try {
      debug("[APIService] Crawling URL:", url);

      const response = await sendMessage("crawlUrl", {
        data: {
          folderId,
          url,
          title: title || getDomainFromUrl(url),
        },
      });

      if (response && response.success) {
        debug("[APIService] URL crawl successful");
        return response;
      }

      // Specific backend error keys bubble up as user-facing messages
      if (response?.errorKey) {
        throw new Error(response.message || "URL could not be processed");
      }

      throw new Error(response?.error || "URL crawl failed");
    } catch (error) {
      console.error("[APIService] URL crawl failed:", error);
      throw error;
    }
  }

  /**
   * Helper: Extract domain from URL for default title.
   */
  function getDomainFromUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace("www.", "");
    } catch {
      return "url-import";
    }
  }

  /**
   * Open CompanyGPT in a new tab (uses CONFIG.BASE_URL).
   */
  async function openCompanyGPT() {
    if (!window.CONFIG || !window.CONFIG.BASE_URL) {
      console.error("[APIService] CONFIG not loaded!");
      throw new Error("Configuration not loaded");
    }
    const url = window.CONFIG.BASE_URL;
    chrome.tabs.create({ url });
  }

  /**
   * Validate API response (kept for compatibility).
   * @param {any} response
   * @returns {true}
   * @throws {Error}
   */
  function validateResponse(response) {
    if (!response) throw new Error("No response received");
    if (response.error) throw new Error(response.error);
    if (!response.success) throw new Error("Request failed");
    return true;
  }

  // Public API
  window.APIService = {
    checkAuthentication,
    fetchFolders,
    uploadAudio,
    crawlUrl,
    openCompanyGPT,
    // validateResponse is intentionally not exported (unused), but keep if you need it:
    // validateResponse,
  };
})(); // End of IIFE
