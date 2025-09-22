// shared/state-manager.js
class StateManager {
  constructor(initialState = {}, options = {}) {
    this.state = this.createProxy(initialState);
    this.listeners = new Map(); // event -> Set<callbacks>
    this.middleware = [];
    this.history = [];
    this.maxHistory = options.maxHistory || 10;
    this.persistKey = options.persistKey || null;
    this.debug = options.debug || false;

    // Chrome extension specific
    this.crossContext = options.crossContext || false;

    if (this.persistKey) {
      this.loadPersistedState();
    }

    if (this.crossContext) {
      this.setupCrossContextSync();
    }
  }

  // Create reactive proxy
  // state-manager.js - Update the createProxy method (around line 30)
  createProxy(obj, path = []) {
    return new Proxy(obj, {
      get: (target, prop) => {
        const value = target[prop];
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return this.createProxy(value, [...path, prop]);
        }
        return value;
      },

      set: (target, prop, value) => {
        const oldValue = target[prop];

        // ✅ Check if value actually changed
        if (oldValue === value) {
          return true; // No change, don't notify
        }

        // For objects, do a deep comparison
        if (typeof value === "object" && typeof oldValue === "object") {
          if (JSON.stringify(oldValue) === JSON.stringify(value)) {
            return true; // No actual change
          }
        }

        target[prop] = value;

        // Notify listeners
        const fullPath = [...path, prop].join(".");
        this.notify(fullPath, value, oldValue);

        // Persist if needed
        if (this.persistKey) {
          this.persistState();
        }

        return true;
      },
    });
  }

  // Get state value by path
  get(path) {
    return path.split(".").reduce((obj, key) => obj?.[key], this.state);
  }

  // Set state with optional middleware
  async set(path, value) {
    // Run middleware
    for (const mw of this.middleware) {
      value = await mw(path, value, this.state);
    }

    // Set value
    const keys = path.split(".");
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => {
      if (!obj[key]) obj[key] = {};
      return obj[key];
    }, this.state);

    // Store history
    if (this.history.length >= this.maxHistory) {
      this.history.shift();
    }
    this.history.push({
      path,
      oldValue: target[lastKey],
      newValue: value,
      timestamp: Date.now(),
    });

    target[lastKey] = value;
  }

  // Batch updates
  batch(updates) {
    const notifications = [];

    for (const [path, value] of Object.entries(updates)) {
      const keys = path.split(".");
      const lastKey = keys.pop();
      const target = keys.reduce((obj, key) => obj[key] || {}, this.state);
      const oldValue = target[lastKey];
      target[lastKey] = value;
      notifications.push({ path, value, oldValue });
    }

    // Notify all at once
    notifications.forEach(({ path, value, oldValue }) => {
      this.notify(path, value, oldValue);
    });

    if (this.persistKey) {
      this.persistState();
    }
  }

  // Subscribe to state changes
  subscribe(path, callback, options = {}) {
    const { immediate = false, deep = false } = options;

    if (!this.listeners.has(path)) {
      this.listeners.set(path, new Set());
    }

    const wrappedCallback = deep
      ? (value, oldValue) => {
          // Deep watch - trigger on any nested change
          if (path === "*" || this.isPathAffected(path, value)) {
            callback(value, oldValue, path);
          }
        }
      : callback;

    this.listeners.get(path).add(wrappedCallback);

    // Immediate execution
    if (immediate) {
      callback(this.get(path), undefined, path);
    }

    // Return unsubscribe function
    return () => {
      this.listeners.get(path)?.delete(wrappedCallback);
    };
  }

  // Notify listeners
  notify(path, value, oldValue) {
    if (this.debug) {
      console.log(`[State] ${path}:`, oldValue, "→", value);
    }

    // Notify exact path listeners
    this.listeners.get(path)?.forEach((cb) => cb(value, oldValue, path));

    // Notify wildcard listeners
    this.listeners.get("*")?.forEach((cb) => cb(this.state, this.state, path));

    // Notify parent path listeners (for deep watching)
    const parts = path.split(".");
    for (let i = parts.length - 1; i > 0; i--) {
      const parentPath = parts.slice(0, i).join(".");
      this.listeners.get(parentPath)?.forEach((cb) => {
        if (cb.deep) cb(this.get(parentPath), oldValue, path);
      });
    }
  }

  // Computed values (memoized)
  computed(name, computeFn, dependencies = []) {
    let cachedValue;
    let hasComputed = false;

    // Auto-detect dependencies if not provided
    if (dependencies.length === 0) {
      const proxy = new Proxy(this.state, {
        get: (target, prop) => {
          dependencies.push(prop);
          return target[prop];
        },
      });
      computeFn.call(proxy);
    }

    const compute = () => {
      cachedValue = computeFn.call(this.state);
      hasComputed = true;
      return cachedValue;
    };

    // Subscribe to dependencies
    dependencies.forEach((dep) => {
      this.subscribe(dep, () => {
        hasComputed = false;
      });
    });

    // Return getter
    Object.defineProperty(this.state, name, {
      get: () => (hasComputed ? cachedValue : compute()),
      enumerable: false,
    });
  }

  // Persistence
  async persistState() {
    if (!this.persistKey) return;

    try {
      await chrome.storage.local.set({
        [this.persistKey]: {
          state: this.state,
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      console.error("[State] Persist failed:", error);
    }
  }

  async loadPersistedState() {
    if (!this.persistKey) return;

    try {
      const result = await chrome.storage.local.get(this.persistKey);
      if (result[this.persistKey]) {
        const { state, timestamp } = result[this.persistKey];
        // Merge with initial state
        Object.assign(this.state, state);

        if (this.debug) {
          console.log("[State] Restored from storage:", state);
        }
      }
    } catch (error) {
      console.error("[State] Load failed:", error);
    }
  }

  // Cross-context synchronization (between popup, content, background)
  // state-manager.js - Update setupCrossContextSync (around line 164)
  setupCrossContextSync() {
    // Add a flag to prevent sync loops
    let isSyncing = false;

    // Listen for state changes from other contexts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "STATE_SYNC" && message.key === this.persistKey) {
        // ✅ Set flag to prevent re-broadcast
        isSyncing = true;

        // Update local state without triggering sync again
        this.batch(message.updates);

        // Reset flag after a microtask
        Promise.resolve().then(() => {
          isSyncing = false;
        });

        sendResponse({ success: true });
      }
    });

    // Broadcast state changes
    const broadcast = (path, value) => {
      // ✅ Don't broadcast if we're syncing from another context
      if (isSyncing) return;

      chrome.runtime
        .sendMessage({
          type: "STATE_SYNC",
          key: this.persistKey,
          updates: { [path]: value },
        })
        .catch(() => {
          // Ignore errors when no listeners
        });
    };

    // Debounce broadcasts
    let broadcastTimer;
    this.subscribe("*", (state, oldState, changedPath) => {
      // ✅ Don't broadcast if syncing
      if (isSyncing) return;

      clearTimeout(broadcastTimer);
      broadcastTimer = setTimeout(() => {
        broadcast(changedPath, this.get(changedPath));
      }, 50);
    });
  }

  // Add middleware
  use(middleware) {
    this.middleware.push(middleware);
  }

  // Time travel debugging
  undo() {
    if (this.history.length > 0) {
      const { path, oldValue } = this.history.pop();
      this.set(path, oldValue);
    }
  }

  // Reset state
  reset(newState = {}) {
    this.history = [];
    this.state = this.createProxy(newState);
    this.notify("*", this.state, {});
  }

  // Get snapshot
  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }
}

// Export for use
if (typeof module !== "undefined" && module.exports) {
  module.exports = StateManager;
} else {
  window.StateManager = StateManager;
}
