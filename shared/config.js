// shared/config.js - Simplified domain detection
(function () {
  "use strict";

  const CONFIG = Object.freeze({
    COOKIE_NAME: "__Secure-next-auth.session-token",
    BASE_DOMAIN: ".506.ai",
    LOGIN_PATH: "/de/login?callbackUrl=%2F",

    // API endpoints (will be built dynamically)
    ENDPOINTS: Object.freeze({
      AUTH_SESSION: "/auth/session",
      FOLDERS: "/folders",
      UPLOAD_MEDIA: "/vs/uploadMedia",
      CRAWL_URL: "/vs/crawlUrl",
    }),

    // Build URLs dynamically based on domain
    buildUrl(domain, path = "") {
      return domain ? `https://${domain}.506.ai${path}` : "";
    },

    buildApiUrl(domain, endpoint) {
      return this.buildUrl(
        domain,
        `/api${this.ENDPOINTS[endpoint] || endpoint}`
      );
    },

    buildLoginUrl(domain) {
      return this.buildUrl(domain, this.LOGIN_PATH);
    },
  });

  // Expose globally
  if (typeof window !== "undefined") window.CONFIG = CONFIG;
  if (typeof globalThis !== "undefined") globalThis.CONFIG = CONFIG;
  if (typeof self !== "undefined") self.CONFIG = CONFIG;
})();
