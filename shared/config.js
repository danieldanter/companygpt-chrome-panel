// config/config.js
// Detect domain from cookies; fallback to lastKnownDomain in storage;
// finally try active tab's *.506.ai subdomain. No staging or default fallback.

(function () {
  "use strict";

  // Toggle verbose logs for development (true locally; false for store)
  const DEBUG = false;
  const debug = (...args) => {
    if (DEBUG) console.log(...args);
  };

  const COOKIE_NAME = "__Secure-next-auth.session-token";
  const BASE_COOKIE_DOMAIN = ".506.ai";
  const LOGIN_PATH = "/de/login?callbackUrl=%2F"; // German UI path

  /**
   * Get all valid CompanyGPT cookies (sorted newest first)
   */
  async function getAllCompanyGPTCookies() {
    try {
      const cookies = await chrome.cookies.getAll({
        domain: BASE_COOKIE_DOMAIN,
        name: COOKIE_NAME,
      });

      if (!cookies || cookies.length === 0) return [];

      // Sort by most recent activity
      cookies.sort((a, b) => {
        const aTime = a.lastAccessed || a.expirationDate || 0;
        const bTime = b.lastAccessed || b.expirationDate || 0;
        return bTime - aTime; // newest first
      });

      const simplified = cookies.map((c) => ({
        domain: c.domain.replace(/^\./, "").replace(".506.ai", ""),
        lastAccessed: c.lastAccessed,
        expirationDate: c.expirationDate,
      }));

      debug(
        "[Config] Cookie domains (newest→oldest):",
        simplified.map((c) => c.domain)
      );
      return simplified;
    } catch (err) {
      // Keep store logs quiet; surface only if DEBUG
      debug("[Config] getAllCompanyGPTCookies error:", err);
      return [];
    }
  }

  /**
   * Try to read lastKnownDomain from storage
   */
  async function getLastKnownDomainFromStorage() {
    try {
      const { lastKnownDomain } = await chrome.storage.local.get(
        "lastKnownDomain"
      );
      return lastKnownDomain || null;
    } catch {
      return null;
    }
  }

  /**
   * Try to infer subdomain from the active tab (if it is *.506.ai)
   */
  async function getActiveTabSubdomain() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const url = tab?.url || "";
      const match = url.match(/^https?:\/\/([a-z0-9-]+)\.506\.ai(?:\/|$)/i);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * Smart domain decision:
   * 1) newest auth cookie (and persist as lastKnownDomain)
   * 2) lastKnownDomain in storage
   * 3) active tab's *.506.ai subdomain
   * NO DEFAULT FALLBACK - returns null if no domain found
   */
  async function chooseDomain() {
    // 1) Check cookies - most recent activity
    const cookies = await getAllCompanyGPTCookies();
    if (cookies.length > 0) {
      const domain = cookies[0].domain;

      // Persist for future use when user is logged out
      await chrome.storage.local.set({ lastKnownDomain: domain });

      const allDomains = [...new Set(cookies.map((c) => c.domain))];
      await chrome.storage.local.set({
        hasMultipleDomains: allDomains.length > 1,
        availableDomains: allDomains,
      });

      debug(`[Config] Using domain from cookie: ${domain}`);
      return { domain, source: "cookie", allDomains };
    }

    // 2) Check storage for last known domain
    const lastKnown = await getLastKnownDomainFromStorage();
    if (lastKnown) {
      debug(`[Config] Using last known domain: ${lastKnown}`);
      return { domain: lastKnown, source: "storage", allDomains: [lastKnown] };
    }

    // 3) Try active tab
    const fromTab = await getActiveTabSubdomain();
    if (fromTab) {
      debug(`[Config] Using domain from active tab: ${fromTab}`);
      await chrome.storage.local.set({ lastKnownDomain: fromTab });
      return { domain: fromTab, source: "activeTab", allDomains: [fromTab] };
    }

    // No domain found at all
    debug("[Config] No domain could be determined");
    return { domain: null, source: "none", allDomains: [] };
  }

  // Declare CONFIG first
  let CONFIG;

  (async function init() {
    const pick = await chooseDomain();
    const DOMAIN = pick.domain; // can be null when nothing known

    const BASE_URL = DOMAIN ? `https://${DOMAIN}.506.ai` : "";
    const API_BASE_URL = DOMAIN ? `${BASE_URL}/api` : "";

    const ENDPOINTS = Object.freeze({
      AUTH_SESSION: "/auth/session",
      FOLDERS: "/folders",
      UPLOAD_MEDIA: "/vs/uploadMedia",
      CRAWL_URL: "/vs/crawlUrl",
    });

    const FULL_ENDPOINTS = Object.freeze({
      AUTH_SESSION: DOMAIN ? `${API_BASE_URL}${ENDPOINTS.AUTH_SESSION}` : "",
      FOLDERS: DOMAIN ? `${API_BASE_URL}${ENDPOINTS.FOLDERS}` : "",
      UPLOAD_MEDIA: DOMAIN ? `${API_BASE_URL}${ENDPOINTS.UPLOAD_MEDIA}` : "",
      CRAWL_URL: DOMAIN ? `${API_BASE_URL}${ENDPOINTS.CRAWL_URL}` : "",
    });

    const TIMEOUTS = Object.freeze({
      API_TIMEOUT: 30000,
      TAB_CREATION_RETRY: 1000,
      TAB_INIT_WAIT: 500,
    });

    CONFIG = Object.freeze({
      // Selection results
      DOMAIN,
      SOURCE: pick.source, // "cookie" | "storage" | "activeTab" | "none"
      HAS_MULTIPLE_DOMAINS: (pick.allDomains || []).length > 1,
      AVAILABLE_DOMAINS: pick.allDomains || [],

      // URLs
      BASE_URL,
      API_BASE_URL,

      // Cookie name
      COOKIE_NAME,

      // Endpoints
      ENDPOINTS,
      FULL_ENDPOINTS,

      // Tunables
      TIMEOUTS,

      /**
       * Build the login URL using our best domain guess.
       * Returns "" if we can't determine a subdomain yet.
       */
      buildLoginUrl() {
        if (!this.DOMAIN) return "";
        return `https://${this.DOMAIN}.506.ai${LOGIN_PATH}`;
      },

      /**
       * Check if we have a valid domain configuration
       */
      isConfigured() {
        return !!this.DOMAIN;
      },
    });

    // Expose globally for both popup and service worker use
    if (typeof window !== "undefined") window.CONFIG = CONFIG;
    if (typeof globalThis !== "undefined") globalThis.CONFIG = CONFIG;
    if (typeof self !== "undefined") self.CONFIG = CONFIG;

    // Keep console quiet for store unless DEBUG is on
    debug(
      `[Config] Ready. Domain: ${CONFIG.DOMAIN || "none"} (source: ${
        CONFIG.SOURCE
      })`
    );
    if (DEBUG && CONFIG.HAS_MULTIPLE_DOMAINS) {
      console.log(
        `[Config] Available domains: ${CONFIG.AVAILABLE_DOMAINS.join(", ")}`
      );
    }
  })();
})();
