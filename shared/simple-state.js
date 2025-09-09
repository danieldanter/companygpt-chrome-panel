// shared/simple-state.js - Unified state management
(function () {
  "use strict";

  class SimpleState {
    constructor() {
      this.state = {
        auth: {
          isAuthenticated: false,
          user: null,
          domain: null,
          hasMultipleDomains: false,
          availableDomains: [],
        },
        context: {
          isLoaded: false,
          data: null,
          url: null,
          title: null,
        },
        chat: {
          messages: [],
          isStreaming: false,
          sessionId: null,
        },
      };

      this.listeners = new Set();
    }

    // Get state
    get(path) {
      const keys = path.split(".");
      let current = this.state;
      for (const key of keys) {
        current = current?.[key];
      }
      return current;
    }

    // Set state and notify
    set(path, value) {
      const keys = path.split(".");
      const lastKey = keys.pop();
      let current = this.state;

      for (const key of keys) {
        if (!current[key]) current[key] = {};
        current = current[key];
      }

      current[lastKey] = value;
      this.notify(path, value);
    }

    // Update nested state
    update(path, updates) {
      const current = this.get(path) || {};
      this.set(path, { ...current, ...updates });
    }

    // Subscribe to changes
    subscribe(callback) {
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }

    // Notify listeners
    notify(path, value) {
      this.listeners.forEach((callback) => {
        try {
          callback(path, value, this.state);
        } catch (error) {
          console.error("[SimpleState] Listener error:", error);
        }
      });
    }
  }

  // Create global state instance
  window.AppState = new SimpleState();
})();
