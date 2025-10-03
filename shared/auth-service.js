// popup/services/auth-service.js - Background-Driven Auth (CONFIG remains immutable)
/* eslint-disable no-undef */
(function () {
  "use strict";
  const debug = window.Debug.create("auth");

  debug.log("[AuthService] Initializing - Background-Driven Auth");

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

  async function clearAllAuthData() {
    debug.log("[AuthService] Clearing all auth data...");

    // Clear all stored auth data
    await chrome.storage.local.remove([
      "authState",
      "lastKnownDomain",
      "chatHistory",
      "chatSessionId",
      "companygpt-state",
    ]);

    // Clear cache
    AuthState.cache = {
      isAuthenticated: null,
      user: null,
      lastCheck: 0,
      TTL: 30000,
      checkInProgress: null,
      activeDomain: null,
      hasMultipleDomains: false,
      availableDomains: [],
    };

    debug.log("[AuthService] All auth data cleared");
  }

  // ============================================
  // CORE AUTH CHECK
  // ============================================
  async function checkAuth(forceRefresh = false) {
    if (!forceRefresh && isCacheValid()) {
      AuthState.stats.cacheHits++;
      debug.log("[AuthService] Cache hit:", AuthState.cache.isAuthenticated);
      return AuthState.cache.isAuthenticated;
    }

    if (AuthState.cache.checkInProgress) {
      debug.log("[AuthService] Check in progress, waiting...");
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
  // ACTUAL AUTH CHECK (background does domain detection)
  // ============================================
  async function performAuthCheck() {
    debug.log("[AuthService] Performing auth check...");
    AuthState.stats.checksPerformed++;

    try {
      // Use background script for domain detection and auth check
      const response = await chrome.runtime.sendMessage({
        action: "checkAuth",
        skipCache: false,
      });

      debug.log("[AuthService] Background response:", response);

      if (response?.success) {
        const domainInfo = {
          domain: response.domain,
          hasMultiple: response.hasMultipleDomains || false,
          availableDomains: response.availableDomains || [],
        };

        debug.log("[AuthService] Domain info before update:", domainInfo);

        updateAuthState(
          response.isAuthenticated,
          response.user,
          response.isAuthenticated ? "Authenticated" : "Not authenticated",
          domainInfo
        );

        debug.log(
          "[AuthService] Domain after updateAuthState:",
          AuthState.cache.activeDomain
        );

        return response.isAuthenticated;
      }

      updateAuthState(false, null, "Background check failed", null);
      return false;
    } catch (error) {
      console.error("[AuthService] Auth check error:", error);
      updateAuthState(false, null, error.message, null);
      return false;
    }
  }

  // ============================================
  // STATE MANAGEMENT
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

    // debug.log log to verify domain is set
    debug.log(
      "[AuthService] Domain after update:",
      AuthState.cache.activeDomain
    );

    // Update unified state
    if (window.AppState) {
      window.AppState.update("auth", {
        isAuthenticated,
        user,
        domain: AuthState.cache.activeDomain,
        hasMultipleDomains: AuthState.cache.hasMultipleDomains,
        availableDomains: AuthState.cache.availableDomains,
      });
    }

    // Notify listeners if there was a change
    if (prev !== isAuthenticated) {
      notifyListeners(isAuthenticated, user);
    }

    // Persist to local storage
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
  // DOMAIN GETTERS
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
  // CACHE / EVENTS / HELPERS
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
    debug.log("[AuthService] Cache cleared");
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
    debug.log("[AuthService] Opening CompanyGPT for login...");

    // CLEAR OLD AUTH DATA BEFORE LOGIN
    await clearAllAuthData();

    try {
      // Rest of the existing login code stays the same...
      let domain = AuthState.cache.activeDomain || null;

      if (!domain) {
        const stored = await chrome.storage.local.get([
          "lastKnownDomain",
          "authState",
        ]);
        domain =
          stored.lastKnownDomain || stored.authState?.activeDomain || null;
      }

      let loginUrl = "";

      if (domain) {
        loginUrl = `https://${domain}.506.ai/de/login?callbackUrl=%2F`;
        debug.log(
          `[AuthService] Login URL (from cached/stored domain): ${loginUrl}`
        );
      } else if (window.CONFIG?.buildLoginUrl && window.CONFIG.isConfigured()) {
        // Fallback to CONFIG builder (may already embed domain)
        loginUrl = window.CONFIG.buildLoginUrl();
        debug.log(`[AuthService] Login URL (from CONFIG): ${loginUrl}`);
      }

      if (!loginUrl) {
        // No domain available - ask user to visit a 506.ai page first
        console.error("[AuthService] No domain available for login");

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

      // Short delay, then re-check auth status
      await new Promise((r) => setTimeout(r, 3000));
      return checkAuth(true);
    } catch (error) {
      console.error("[AuthService] Login failed:", error);
      return false;
    }
  }

  function logout() {
    debug.log("[AuthService] Logging out...");
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
    debug.log("[AuthService] Initializing (background-driven)...");

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
          debug.log("[AuthService] Restored state from storage");
          debug.log(`[AuthService] Domain: ${AuthState.cache.activeDomain}`);
        }
      }
    } catch (error) {
      console.warn("[AuthService] Failed to restore auth state:", error);
    }

    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === "authStateChanged") {
        debug.log("[AuthService] Auth state changed from background");
        clearCache();
        checkAuth(true);
      }
    });

    const isAuthed = await checkAuth();
    debug.log("[AuthService] Initial auth check:", isAuthed);
    debug.log(`[AuthService] Active domain: ${AuthState.cache.activeDomain}`);

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

  debug.log("[AuthService] Ready - Background-Driven Auth (immutable CONFIG)");
})();
