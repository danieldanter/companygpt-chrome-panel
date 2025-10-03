// shared/devtools.js
(function () {
  "use strict";

  // ============================================
  // DEBUG CONFIGURATION
  // Set GLOBAL_DEBUG to false for production
  // ============================================
  const GLOBAL_DEBUG = false; // <-- CHANGE THIS TO false FOR PRODUCTION

  const DEBUG_MODULES = {
    app: true,
    auth: true,
    api: true,
    chat: true,
    context: true,
    background: true,
    content: true,
    state: true,
    datenspeicher: true,
    audio: true,
    utils: true,
  };

  // Debug logger functionality
  const Debug = {
    isEnabled(module) {
      return GLOBAL_DEBUG && DEBUG_MODULES[module];
    },

    create(moduleName) {
      const isEnabled = GLOBAL_DEBUG && DEBUG_MODULES[moduleName];

      return {
        log: isEnabled
          ? (...args) => debug.log(`[${moduleName}]`, ...args)
          : () => {},
        warn: isEnabled
          ? (...args) => console.warn(`[${moduleName}]`, ...args)
          : () => {},
        error: (...args) => console.error(`[${moduleName}]`, ...args), // Always show errors
        debug: isEnabled
          ? (...args) => debug.log(`[${moduleName}:DEBUG]`, ...args)
          : () => {},
      };
    },
  };

  // Existing DevTools class for state inspection

  const debug = Debug.create("devtools");
  class DevTools {
    static init(store) {
      if (!store) {
        console.error("[DevTools] No store provided!");
        return;
      }

      debug.log("[DevTools] Initializing with store:", store);

      // Use $$ instead of $ to avoid jQuery conflict!
      window.$$ = {
        state: () => {
          if (store.snapshot) {
            return store.snapshot();
          } else if (store.state) {
            return JSON.parse(JSON.stringify(store.state));
          }
          return {};
        },
        get: (path) => store.get(path),
        set: (path, val) => store.set(path, val),
        clear: () =>
          store.reset ? store.reset() : debug.log("Reset not available"),
        auth: () => store.get("auth"),
        chat: () => store.get("chat"),
        context: () => store.get("context"),
        ui: () => store.get("ui"),
        store: store,

        // Add debug control to $$ commands
        debug: {
          on: () => {
            Object.keys(DEBUG_MODULES).forEach(
              (m) => (DEBUG_MODULES[m] = true)
            );
            debug.log("Debug enabled for all modules");
          },
          off: () => {
            Object.keys(DEBUG_MODULES).forEach(
              (m) => (DEBUG_MODULES[m] = false)
            );
            debug.log("Debug disabled for all modules");
          },
          status: () => {
            debug.log("Debug:", GLOBAL_DEBUG ? "ON" : "OFF");
            debug.log(
              "Active modules:",
              Object.entries(DEBUG_MODULES)
                .filter(([_, v]) => v)
                .map(([k]) => k)
            );
          },
        },

        // Add helper to see what methods store has
        help: () => {
          debug.log(
            "Available store methods:",
            Object.getOwnPropertyNames(Object.getPrototypeOf(store))
          );
          debug.log("Store object:", store);
          debug.log(
            "Debug commands: $$.debug.on(), $$.debug.off(), $$.debug.status()"
          );
        },
      };

      // Also expose as __STATE__ and _store for alternatives
      window.__STATE__ = window.$$;
      window._store = store;

      // Only log state changes if debug is enabled
      if (GLOBAL_DEBUG) {
        if (store.subscribe) {
          store.subscribe("auth.isAuthenticated", (val) => {
            debug.log(`🔐 Auth: ${val ? "Logged In" : "Logged Out"}`);
          });

          store.subscribe("context.isLoaded", (val) => {
            debug.log(`📄 Context: ${val ? "Loaded" : "Cleared"}`);
          });
        }
      }

      debug.log("✅ DevTools Ready!");
      debug.log("Commands: $$.state(), $$.auth(), $$.chat(), $$.context()");
      debug.log("Debug: $$.debug.status(), $$.debug.on(), $$.debug.off()");
      debug.log("Alternative: window._store or window.__STATE__");
    }
  }

  // Expose both DevTools and Debug
  window.DevTools = DevTools;
  window.Debug = Debug;

  // For service worker compatibility
  if (typeof self !== "undefined") {
    self.Debug = Debug;
  }

  // Auto-initialize DevTools if AppStore exists
  if (window.AppStore) {
    debug.log("[DevTools] Found AppStore, auto-initializing...");
    DevTools.init(window.AppStore);
  } else {
    if (GLOBAL_DEBUG) {
      debug.log("[DevTools] Waiting for AppStore...");
    }
    let checkCount = 0;
    const checkInterval = setInterval(() => {
      checkCount++;
      if (window.AppStore) {
        debug.log("[DevTools] AppStore found, initializing...");
        DevTools.init(window.AppStore);
        clearInterval(checkInterval);
      } else if (checkCount > 20) {
        if (GLOBAL_DEBUG) {
          console.warn("[DevTools] AppStore not found after 2 seconds");
        }
        clearInterval(checkInterval);
      }
    }, 100);
  }
})();
