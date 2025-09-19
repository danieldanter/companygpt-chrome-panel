// shared/devtools.js
(function () {
  "use strict";

  class DevTools {
    static init(store) {
      if (!store) {
        console.error("[DevTools] No store provided!");
        return;
      }

      console.log("[DevTools] Initializing with store:", store);

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
          store.reset ? store.reset() : console.log("Reset not available"),
        auth: () => store.get("auth"),
        chat: () => store.get("chat"),
        context: () => store.get("context"),
        ui: () => store.get("ui"),
        store: store,

        // Add helper to see what methods store has
        help: () => {
          console.log(
            "Available store methods:",
            Object.getOwnPropertyNames(Object.getPrototypeOf(store))
          );
          console.log("Store object:", store);
        },
      };

      // Also expose as __STATE__ and _store for alternatives
      window.__STATE__ = window.$$;
      window._store = store;

      // Log state changes
      if (store.subscribe) {
        store.subscribe("auth.isAuthenticated", (val) => {
          console.log(`🔐 Auth: ${val ? "Logged In" : "Logged Out"}`);
        });

        store.subscribe("context.isLoaded", (val) => {
          console.log(`📄 Context: ${val ? "Loaded" : "Cleared"}`);
        });
      }

      console.log("✅ DevTools Ready!");
      console.log("Commands: $$.state(), $$.auth(), $$.chat(), $$.context()");
      console.log("Alternative: window._store or window.__STATE__");
    }
  }

  // Expose DevTools
  window.DevTools = DevTools;

  // Auto-initialize if AppStore exists
  if (window.AppStore) {
    console.log("[DevTools] Found AppStore, auto-initializing...");
    DevTools.init(window.AppStore);
  } else {
    console.log("[DevTools] Waiting for AppStore...");
    let checkCount = 0;
    const checkInterval = setInterval(() => {
      checkCount++;
      if (window.AppStore) {
        console.log("[DevTools] AppStore found, initializing...");
        DevTools.init(window.AppStore);
        clearInterval(checkInterval);
      } else if (checkCount > 20) {
        console.warn("[DevTools] AppStore not found after 2 seconds");
        clearInterval(checkInterval);
      }
    }, 100);
  }
})();
