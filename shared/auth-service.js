// popup/services/auth-service.js - Smart Domain Detection (CONFIG remains immutable)
/* eslint-disable no-undef */
(function () {
  "use strict";

  // Toggle verbose logs for development (true locally; false for store)
  const DEBUG = false;
  const debug = (...args) => {
    if (DEBUG) console.log(...args);
  };

  debug("[AuthService] Initializing - With Smart Domain Detection");

  // ============================================
  // SINGLETON AUTH STATE
  // ============================================
  const AuthState = {
    cache: {
      isAuthenticated: null,
      user: null,
      lastCheck: 0,
      TTL: 30000, // 30 seconds cache
      checkInProgress: null,
      // Domain cache
      activeDomain: null,
      hasMultipleDomains: false,
      availableDomains: [],
    },
    session: {
      token: null,
      expiresAt: null,
    },
    listeners: new Set(),
    stats: {
      checksPerformed: 0,
      cacheHits: 0,
      cacheMisses: 0,
    },
  };

  // ============================================
  // SMART DOMAIN DETECTION (matching config.js logic)
  // ============================================
  async function detectActiveDomain() {
    try {
      const COOKIE_NAME = "__Secure-next-auth.session-token";

      const cookies = await chrome.cookies.getAll({
        domain: ".506.ai",
        name: COOKIE_NAME,
      });

      if (!cookies || cookies.length === 0) {
        debug("[AuthService] No cookies found");
        return { domain: null, hasMultiple: false, availableDomains: [] };
      }

      cookies.sort((a, b) => {
        const timeA = a.lastAccessed || a.expirationDate || 0;
        const timeB = b.lastAccessed || b.expirationDate || 0;
        return timeB - timeA;
      });

      const domains = cookies.map((c) =>
        c.domain.replace(/^\./, "").replace(".506.ai", "")
      );
      const uniqueDomains = [...new Set(domains)];
      const activeDomain = domains[0];

      debug(`[AuthService] Active domain: ${activeDomain}`);
      debug(`[AuthService] Total domains: ${uniqueDomains.length}`);

      return {
        domain: activeDomain,
        hasMultiple: uniqueDomains.length > 1,
        availableDomains: uniqueDomains,
      };
    } catch (error) {
      console.error("[AuthService] Domain detection failed:", error);
      return { domain: null, hasMultiple: false, availableDomains: [] };
    }
  }

  // ============================================
  // CORE AUTH CHECK - UPDATED WITH DOMAIN INFO
  // ============================================
  async function checkAuth(forceRefresh = false) {
    if (!forceRefresh && isCacheValid()) {
      AuthState.stats.cacheHits++;
      debug("[AuthService] Cache hit:", AuthState.cache.isAuthenticated);
      return AuthState.cache.isAuthenticated;
    }

    if (AuthState.cache.checkInProgress) {
      debug("[AuthService] Check in progress, waiting...");
      return AuthState.cache.checkInProgress;
    }

    AuthState.stats.cacheMisses++;
    AuthState.cache.checkInProgress = performAuthCheck();

    try {
      const result = await AuthState.cache.checkInProgress;
      return result;
    } finally {
      AuthState.cache.checkInProgress = null;
    }
  }

  // ============================================
  // ACTUAL AUTH CHECK WITH DOMAIN DETECTION
  // ============================================
  async function performAuthCheck() {
    debug("[AuthService] Performing auth check with domain detection...");
    AuthState.stats.checksPerformed++;

    try {
      // 1) Detect active domain
      const domainInfo = await detectActiveDomain();

      if (!domainInfo.domain) {
        updateAuthState(false, null, "No domain/cookie found", domainInfo);
        return false;
      }

      // Cache domain info (read-only CONFIG remains untouched)
      AuthState.cache.activeDomain = domainInfo.domain;
      AuthState.cache.hasMultipleDomains = domainInfo.hasMultiple;
      AuthState.cache.availableDomains = domainInfo.availableDomains;

      // 2) Ask background to check auth (it uses smart domain too)
      const response = await chrome.runtime.sendMessage({
        action: "checkAuth",
        skipCache: false,
      });

      if (response?.success && response?.isAuthenticated) {
        updateAuthState(true, response.user, "Authenticated via background", {
          domain: response.domain ?? domainInfo.domain,
          hasMultiple: response.hasMultipleDomains ?? domainInfo.hasMultiple,
          availableDomains:
            response.availableDomains ?? domainInfo.availableDomains,
        });
        return true;
      }

      if (response?.success && !response?.isAuthenticated) {
        updateAuthState(false, null, "Not authenticated", {
          domain: response.domain ?? domainInfo.domain,
          hasMultiple: response.hasMultipleDomains ?? domainInfo.hasMultiple,
          availableDomains:
            response.availableDomains ?? domainInfo.availableDomains,
        });
        return false;
      }

      console.warn("[AuthService] Background check failed, using fallback");
      updateAuthState(false, null, "Background check failed", domainInfo);
      return false;
    } catch (error) {
      console.error("[AuthService] Auth check error:", error);
      const emptyDomainInfo = {
        domain: AuthState.cache.activeDomain ?? null,
        hasMultiple: AuthState.cache.hasMultipleDomains ?? false,
        availableDomains: AuthState.cache.availableDomains ?? [],
      };
      updateAuthState(false, null, error.message, emptyDomainInfo);
      return false;
    }
  }

  // ============================================
  // STATE MANAGEMENT - UPDATED WITH DOMAIN INFO
  // ============================================
  function updateAuthState(isAuthenticated, user, reason, domainInfo = null) {
    const prev = AuthState.cache.isAuthenticated;

    AuthState.cache.isAuthenticated = isAuthenticated;
    AuthState.cache.user = user;
    AuthState.cache.lastCheck = Date.now();

    if (domainInfo) {
      AuthState.cache.activeDomain = domainInfo.domain;
      AuthState.cache.hasMultipleDomains = domainInfo.hasMultiple;
      AuthState.cache.availableDomains = domainInfo.availableDomains;
    }

    debug(
      `[AuthService] Auth state: ${isAuthenticated} (${reason}) | Domain: ${AuthState.cache.activeDomain}`
    );

    // Update StateStore with domain info first
    if (window.StateStore && window.ActionTypes) {
      if (domainInfo) {
        window.StateStore.dispatch(window.ActionTypes.DOMAIN_DETECTED, {
          domain: domainInfo.domain,
          hasMultiple: domainInfo.hasMultiple,
          availableDomains: domainInfo.availableDomains,
        });
      }
      // If StorageService caches folders, clear its cache on domain switch
      try {
        if (window.StorageService?.clearData) {
          window.StorageService.clearData(["folders"]);
        }
      } catch (e) {
        console.warn("[AuthService] Could not clear folders cache:", e);
      }
      // Then auth state
      if (isAuthenticated) {
        window.StateStore.dispatch(window.ActionTypes.AUTH_CHECK_SUCCESS, {
          user,
          domain: AuthState.cache.activeDomain,
          hasMultipleDomains: AuthState.cache.hasMultipleDomains,
          availableDomains: AuthState.cache.availableDomains,
        });
      } else {
        window.StateStore.dispatch(window.ActionTypes.AUTH_CHECK_FAILURE, {
          error: reason,
        });
      }
    }

    if (prev !== isAuthenticated) {
      notifyListeners(isAuthenticated, user);
    }

    chrome.storage.local
      .set({
        authState: {
          isAuthenticated,
          user,
          timestamp: Date.now(),
          activeDomain: AuthState.cache.activeDomain,
          hasMultipleDomains: AuthState.cache.hasMultipleDomains,
          availableDomains: AuthState.cache.availableDomains,
        },
      })
      .catch(console.error);
  }

  // ============================================
  // NEW GETTER METHODS FOR DOMAIN INFO
  // ============================================
  function getActiveDomain() {
    return AuthState.cache.activeDomain;
  }
  function hasMultipleDomains() {
    return AuthState.cache.hasMultipleDomains;
  }
  function getAvailableDomains() {
    return AuthState.cache.availableDomains || [];
  }
  function getDomainDisplayName() {
    const domain = AuthState.cache.activeDomain;
    if (!domain) return "CompanyGPT";
    return domain
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // ============================================
  // CACHE / EVENTS / HELPERS (unchanged)
  // ============================================
  function isCacheValid() {
    if (AuthState.cache.isAuthenticated === null) return false;
    return Date.now() - AuthState.cache.lastCheck < AuthState.cache.TTL;
  }

  function clearCache() {
    AuthState.cache.isAuthenticated = null;
    AuthState.cache.user = null;
    AuthState.cache.lastCheck = 0;
    AuthState.cache.checkInProgress = null;
    debug("[AuthService] Cache cleared");
  }

  function onAuthChange(callback) {
    AuthState.listeners.add(callback);
    return () => AuthState.listeners.delete(callback);
  }

  function notifyListeners(isAuthenticated, user) {
    AuthState.listeners.forEach((cb) => {
      try {
        cb(isAuthenticated, user);
      } catch (e) {
        console.error("[AuthService] Listener error:", e);
      }
    });
  }

  function isAuthenticated() {
    return AuthState.cache.isAuthenticated === true;
  }
  function getUser() {
    return AuthState.cache.user;
  }
  function getAuthStats() {
    return {
      ...AuthState.stats,
      cacheStatus: isCacheValid() ? "valid" : "expired",
      lastCheck: AuthState.cache.lastCheck
        ? new Date(AuthState.cache.lastCheck).toLocaleTimeString()
        : "never",
    };
  }

  async function requireAuth(showPrompt = true) {
    const authed = await checkAuth();
    if (!authed && showPrompt) {
      if (confirm("Bitte melde dich erst bei CompanyGPT an! Jetzt anmelden?")) {
        return login();
      }
    }
    return authed;
  }

  // ============================================
  // LOGIN / LOGOUT
  // ============================================
  async function login() {
    debug("[AuthService] Opening CompanyGPT for login...");
    clearCache();

    try {
      // 1. First try to get domain from current detection
      const domainInfo = await detectActiveDomain();
      let loginUrl = "";

      if (domainInfo.domain) {
        loginUrl = `https://${domainInfo.domain}.506.ai/de/login?callbackUrl=%2F`;
        debug(`[AuthService] Login URL from detected domain: ${loginUrl}`);
      } else {
        // 2. Try to get last known domain from storage
        const stored = await chrome.storage.local.get(["lastKnownDomain"]);
        if (stored.lastKnownDomain) {
          loginUrl = `https://${stored.lastKnownDomain}.506.ai/de/login?callbackUrl=%2F`;
          debug(`[AuthService] Login URL from stored domain: ${loginUrl}`);
        } else if (
          window.CONFIG?.buildLoginUrl &&
          window.CONFIG.isConfigured()
        ) {
          // 3. Use CONFIG if it has a valid domain
          loginUrl = window.CONFIG.buildLoginUrl();
          debug(`[AuthService] Login URL from CONFIG: ${loginUrl}`);
        }
      }

      if (!loginUrl) {
        // No domain found at all - ask user to visit a 506.ai page first
        console.error("[AuthService] No domain available for login");

        // Show helpful message to user
        if (window.UIController?.showError) {
          window.UIController.showError(
            "Bitte besuche zuerst eine 506.ai Seite, um die Domain zu erkennen"
          );
        } else {
          alert(
            "Bitte besuche zuerst eine 506.ai Seite, um die Domain zu erkennen"
          );
        }

        return false;
      }

      // Open the login page
      await chrome.tabs.create({ url: loginUrl });

      // Wait a bit for login to potentially complete
      await new Promise((r) => setTimeout(r, 3000));

      // Re-check auth status
      return checkAuth(true);
    } catch (error) {
      console.error("[AuthService] Login failed:", error);
      return false;
    }
  }

  function logout() {
    debug("[AuthService] Logging out...");
    clearCache();
    updateAuthState(false, null, "User logged out");

    chrome.storage.local.remove(["authState"]).catch(console.error);

    if (window.StorageService?.clearData) {
      window.StorageService.clearData(["folders"]);
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  async function initialize() {
    debug("[AuthService] Initializing with domain detection...");

    try {
      const stored = await chrome.storage.local.get("authState");
      if (stored.authState) {
        const age = Date.now() - stored.authState.timestamp;
        if (age < 300000) {
          AuthState.cache.isAuthenticated = stored.authState.isAuthenticated;
          AuthState.cache.user = stored.authState.user;
          AuthState.cache.lastCheck = stored.authState.timestamp;
          AuthState.cache.activeDomain = stored.authState.activeDomain;
          AuthState.cache.hasMultipleDomains =
            stored.authState.hasMultipleDomains;
          AuthState.cache.availableDomains =
            stored.authState.availableDomains || [];
          debug("[AuthService] Restored state from storage");
          debug(`[AuthService] Domain: ${AuthState.cache.activeDomain}`);
        }
      }
    } catch (error) {
      console.warn("[AuthService] Failed to restore auth state:", error);
    }

    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === "authStateChanged") {
        debug("[AuthService] Auth state changed from background");
        clearCache();
        checkAuth(true);
      }
    });

    const isAuthed = await checkAuth();
    debug("[AuthService] Initial auth check:", isAuthed);
    debug(`[AuthService] Active domain: ${AuthState.cache.activeDomain}`);

    return isAuthed;
  }

  // ============================================
  // PUBLIC API
  // ============================================
  window.AuthService = {
    initialize,
    checkAuth,
    login,
    logout,

    isAuthenticated,
    getUser,
    getAuthStats,

    // Domain getters
    getActiveDomain,
    hasMultipleDomains,
    getAvailableDomains,
    getDomainDisplayName,

    // Utilities
    requireAuth,
    clearCache,
    onAuthChange,

    // Cache configuration
    setCacheTTL: (ms) => {
      AuthState.cache.TTL = ms;
    },

    _state: AuthState,
  };

  debug("[AuthService] Ready - With Smart Domain Detection (immutable CONFIG)");
})();
