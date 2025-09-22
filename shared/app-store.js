// shared/app-store.js
(function () {
  "use strict";

  // Import or use global StateManager
  const StateManager = window.StateManager;

  if (!StateManager) {
    console.error(
      "[AppStore] StateManager not found! Make sure state-manager.js loads first"
    );
    return;
  }

  // Define initial state structure
  const initialState = {
    // Authentication
    auth: {
      isAuthenticated: false,
      user: null,
      domain: null,
      activeDomain: null,
      hasMultipleDomains: false,
      availableDomains: [],
      sessionToken: null,
      expiresAt: null,
      lastCheck: 0,
    },

    // Chat
    chat: {
      messages: [],
      sessionId: null,
      isStreaming: false,
      currentIntent: null, // 'email-reply', 'doc-summary', etc.
      folderId: null,
      roleId: null,
      model: {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        maxLength: 950000,
      },
      lastUserIntent: null,
      // ADD THE NEW PROPERTIES HERE ↓↓↓
      multiStepProcess: {
        active: false,
        type: null, // 'email-datenspeicher-reply'
        currentStep: 0,
        totalSteps: 3,
        canAbort: true,
        abortController: null,
        steps: [],
      },
      extractedQuery: null,
      ragResults: null,
    },

    // Context
    context: {
      isLoaded: false,
      url: null,
      title: null,
      domain: null,
      content: null,
      selectedText: null,
      pageType: null, // 'gmail', 'docs', 'sharepoint', 'web'
      wordCount: 0,
      isGmail: false,
      isGoogleDocs: false,
      isSharePoint: false,
      metadata: {},
      extractionMethod: null,
    },

    // UI State
    ui: {
      activeView: "chat", // 'chat' | 'settings'
      isLoading: false,
      showLoginOverlay: false,
      contextBarVisible: false,
      contextActionsVisible: false,
      messageInput: "",
      errors: [],
      notifications: [],
      currentDomain: null,
      useContext: true, // Settings flag
      sidebarOpen: true,
    },

    // Persistent Settings
    settings: {
      theme: "auto", // 'light' | 'dark' | 'auto'
      fontSize: "medium",
      sendOnEnter: true,
      enableNotifications: true,
      autoLoadContext: false,
      debugMode: false,
    },

    // Tab/Page Info
    tab: {
      id: null,
      url: null,
      title: null,
      isActive: true,
      lastUpdated: null,
    },
  };

  // Create store instance with configuration
  const store = new StateManager(initialState, {
    persistKey: "companygpt-state",
    debug: true, // Set to false in production
    crossContext: true, // Sync between popup, content, background
    maxHistory: 30,

    // Define what to persist to chrome.storage
    persistPaths: [
      "auth.domain",
      "auth.activeDomain",
      "auth.availableDomains",
      "auth.user",
      "chat.sessionId",
      "chat.messages", // Last 50 messages only
      "settings", // All settings
      "ui.useContext",
    ],
  });

  // Add computed properties
  store.computed("hasContext", function () {
    return this.context.isLoaded && !!this.context.content;
  });

  store.computed("canSendMessage", function () {
    return this.auth.isAuthenticated && !this.chat.isStreaming;
  });

  store.computed("contextDisplay", function () {
    if (!this.context.isLoaded) return "Kein Kontext geladen";
    const pageType = this.context.pageType;
    const title = this.context.title || "Unbenannte Seite";
    const words = this.context.wordCount;

    let icon = "📄";
    if (pageType === "gmail") icon = "📧";
    else if (pageType === "docs") icon = "📝";
    else if (pageType === "sharepoint") icon = "📊";

    return `${icon} ${title} (${words} Wörter)`;
  });

  store.computed("authDisplay", function () {
    if (!this.auth.isAuthenticated) return "Nicht verbunden";
    const domain = this.auth.activeDomain || this.auth.domain;
    return domain ? `${domain}.506.ai` : "Verbunden";
  });

  // Add middleware for validation and side effects
  store.use(async (path, value, state) => {
    // Auto-clear errors after 5 seconds
    if (path === "ui.errors" && value.length > 0) {
      setTimeout(() => {
        store.set("ui.errors", []);
      }, 5000);
    }

    // Limit chat messages history
    if (path === "chat.messages" && value.length > 100) {
      // Keep only last 100 messages in memory
      return value.slice(-100);
    }

    // Validate auth token expiry
    if (path === "auth.sessionToken" && value) {
      const expiresAt = state.auth.expiresAt;
      if (expiresAt && Date.now() > expiresAt) {
        // Token expired, clear auth
        store.batch({
          "auth.isAuthenticated": false,
          "auth.sessionToken": null,
          "ui.showLoginOverlay": true,
        });
        throw new Error("Session expired");
      }
    }

    // Track context changes
    if (path.startsWith("context.") && path !== "context.isLoaded") {
      console.log("[AppStore] Context updated:", path, value);
    }

    return value;
  });

  // Helper methods
  store.actions = {
    // Auth actions
    login(domain, user) {
      store.batch({
        "auth.isAuthenticated": true,
        "auth.domain": domain,
        "auth.activeDomain": domain,
        "auth.user": user,
        "auth.lastCheck": Date.now(),
        "ui.showLoginOverlay": false,
      });
    },

    logout() {
      store.batch({
        "auth.isAuthenticated": false,
        "auth.user": null,
        "auth.sessionToken": null,
        "chat.messages": [],
        "chat.sessionId": null,
        "context.isLoaded": false,
        "ui.showLoginOverlay": true,
      });
    },

    // Chat actions
    addMessage(role, content, metadata = {}) {
      const message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role,
        content,
        timestamp: Date.now(),
        ...metadata,
      };

      const messages = store.get("chat.messages") || [];
      store.set("chat.messages", [...messages, message]);
      return message;
    },

    clearChat() {
      store.batch({
        "chat.messages": [],
        "chat.sessionId": null,
        "chat.currentIntent": null,
      });
    },

    // Context actions
    setContext(contextData) {
      const wordCount = contextData.content
        ? contextData.content.split(/\s+/).filter((w) => w.length > 0).length
        : 0;

      store.batch({
        "context.isLoaded": true,
        "context.url": contextData.url,
        "context.title": contextData.title,
        "context.content": contextData.content || contextData.mainContent,
        "context.selectedText": contextData.selectedText,
        "context.pageType": contextData.pageType || contextData.siteType,
        "context.wordCount": wordCount,
        "context.isGmail":
          contextData.isGmail || contextData.siteType === "gmail",
        "context.isGoogleDocs":
          contextData.isGoogleDocs || contextData.siteType === "google-docs",
        // ADD THIS LINE
        "context.isOutlook":
          contextData.isOutlook || contextData.siteType === "outlook",
        // ADD THIS LINE
        "context.isEmail":
          contextData.isEmail || contextData.isGmail || contextData.isOutlook,
        "context.emailProvider": contextData.emailProvider, // ADD THIS LINE
        "context.metadata": contextData.metadata || {},
        "ui.contextBarVisible": true,
      });
    },

    clearContext() {
      store.batch({
        "context.isLoaded": false,
        "context.url": null,
        "context.title": null,
        "context.content": null,
        "context.pageType": null,
        "ui.contextBarVisible": false,
      });
    },

    // UI actions
    showError(message) {
      const errors = store.get("ui.errors") || [];
      errors.push({
        id: Date.now(),
        message,
        timestamp: Date.now(),
      });
      store.set("ui.errors", errors);
    },

    showNotification(message, type = "info") {
      const notifications = store.get("ui.notifications") || [];
      notifications.push({
        id: Date.now(),
        message,
        type,
        timestamp: Date.now(),
      });
      store.set("ui.notifications", notifications);
    },

    setLoading(isLoading) {
      store.set("ui.isLoading", isLoading);
    },
  };

  // Initialize DevTools in development
  if (store.debug && window.DevTools) {
    window.DevTools.init(store);
  }

  // Expose globally
  window.AppStore = store;

  // Also expose to old AppState for compatibility during migration
  window.AppState = {
    // Compatibility layer for old code
    get: (path) => store.get(path),
    set: (path, value) => store.set(path, value),
    update: (path, updates) => {
      const current = store.get(path) || {};
      store.set(path, { ...current, ...updates });
    },
    subscribe: (callback) => store.subscribe("*", callback),
  };

  console.log("[AppStore] Initialized with state management");
  console.log("[AppStore] Debug mode:", store.debug);
  if (store.debug) {
    console.log("[AppStore] Use $.state() in console to inspect");
  }
})();
