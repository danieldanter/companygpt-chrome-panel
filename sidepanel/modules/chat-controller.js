// sidepanel/modules/chat-controller.js

export class ChatController {
  constructor() {
    // ===== NEW: Use AppStore =====
    this.store = window.AppStore;

    // OLD: Keep for compatibility
    this.messages = [];
    this.currentContext = null;
    this.sessionId = null; // Will be generated on first message
    this.isInitialized = false;
    this.isStreaming = false;
    this.abortController = null;
    this.lastUserIntent = null; // track intent

    // CompanyGPT specific data
    this.folderId = null;
    this.roleId = null;
    this.model = {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      maxLength: 950000,
      tokenLimit: 950000,
    };

    // Debug flag
    this.debug = true;

    // ===== NEW: Setup state sync =====
    this.setupStateSync();
  }

  /**
   * Debug logger
   */
  log(...args) {
    if (this.debug) {
      console.log("[ChatController]", ...args);
    }
  }

  // ===== ADD THIS NEW METHOD =====
  setupStateSync() {
    console.log("[ChatController] Setting up state sync...");

    // Sync messages with store
    this.store.subscribe("chat.messages", (messages) => {
      this.messages = messages || []; // Keep old array in sync
      console.log(
        "[ChatController] Messages synced from store:",
        this.messages.length
      );
    });

    // Sync session ID
    this.store.subscribe("chat.sessionId", (sessionId) => {
      this.sessionId = sessionId;
      console.log("[ChatController] Session ID synced:", sessionId);
    });

    // Sync streaming state
    this.store.subscribe("chat.isStreaming", (isStreaming) => {
      this.isStreaming = isStreaming;
    });

    // Sync folder/role IDs
    this.store.subscribe("chat.folderId", (folderId) => {
      this.folderId = folderId;
    });

    this.store.subscribe("chat.roleId", (roleId) => {
      this.roleId = roleId;
    });

    // Sync last user intent
    this.store.subscribe("chat.lastUserIntent", (intent) => {
      this.lastUserIntent = intent;
    });
  }

  /**
   * Initialize the chat controller
   */
  async initialize() {
    this.log("Initializing with state management...");

    try {
      // Load folders and roles from CompanyGPT
      await this.loadFoldersAndRoles();

      // ===== NEW: Load from store instead of chrome.storage =====
      const storedMessages = this.store.get("chat.messages") || [];
      const storedSessionId = this.store.get("chat.sessionId");

      if (storedSessionId) {
        this.log("Restored session from store:", storedSessionId);
      }

      if (storedMessages.length > 0) {
        // Only load messages from today
        const today = new Date().toDateString();
        const todaysMessages = storedMessages.filter((msg) => {
          const msgDate = new Date(msg.timestamp || Date.now()).toDateString();
          return msgDate === today;
        });

        // Update store with filtered messages
        this.store.set("chat.messages", todaysMessages);
        this.log(`Loaded ${todaysMessages.length} messages from store`);
      }

      // Set up message handlers
      this.setupMessageHandlers();

      this.isInitialized = true;

      // ===== NEW: Update store =====
      this.store.set("chat.initialized", true);

      this.log("Initialized successfully", {
        folderId: this.folderId,
        roleId: this.roleId,
        messagesLoaded: this.store.get("chat.messages").length,
      });

      return true;
    } catch (error) {
      console.error("[ChatController] Initialization failed:", error);
      this.isInitialized = false;
      this.store.set("chat.initialized", false);
      this.store.actions.showError(
        "Chat initialization failed: " + (error?.message || String(error))
      );
      return false;
    }
  }

  /**
   * Load folders and roles - Update to use store
   */
  async loadFoldersAndRoles() {
    this.log("Loading folders and roles...");

    try {
      // Get domain from store instead of AuthService
      const domain =
        this.store.get("auth.domain") || this.store.get("auth.activeDomain");

      if (!domain) {
        throw new Error(
          "No domain configured. Please ensure you're logged in."
        );
      }

      this.log("Using domain from store:", domain);

      // Load folders
      const foldersUrl = `https://${domain}.506.ai/api/folders`;
      this.log("Fetching folders from:", foldersUrl);

      const foldersResponse = await this.makeAuthenticatedRequest(foldersUrl);
      const foldersData = await foldersResponse.json();

      this.log("Folders response:", foldersData);

      // Find ROOT_CHAT folder
      const rootChatFolder = foldersData.folders?.find(
        (f) => f.type === "ROOT_CHAT"
      );
      if (!rootChatFolder) {
        throw new Error("No ROOT_CHAT folder found");
      }

      // ===== NEW: Update store =====
      this.store.set("chat.folderId", rootChatFolder.id);
      this.log("Found ROOT_CHAT folder:", {
        id: rootChatFolder.id,
        name: rootChatFolder.name,
      });

      // Load roles
      const rolesUrl = `https://${domain}.506.ai/api/roles`;
      this.log("Fetching roles from:", rolesUrl);

      const rolesResponse = await this.makeAuthenticatedRequest(rolesUrl);
      const rolesData = await rolesResponse.json();

      this.log("Roles response:", rolesData);

      // Find default role
      const defaultRole = rolesData.roles?.find((r) => r.defaultRole === true);
      if (!defaultRole) {
        // Fallback to first role if no default
        const firstRole = rolesData.roles?.[0];
        if (firstRole) {
          this.store.set("chat.roleId", firstRole.roleId);
          this.log("No default role found, using first role:", {
            id: firstRole.roleId,
            name: firstRole.name,
          });
        } else {
          throw new Error("No roles available");
        }
      } else {
        this.store.set("chat.roleId", defaultRole.roleId);
        this.log("Found default role:", {
          id: defaultRole.roleId,
          name: defaultRole.name,
        });
      }
    } catch (error) {
      console.error("[ChatController] Failed to load folders/roles:", error);
      throw error;
    }
  }

  /**
   * Make authenticated request with cookies
   */
  async makeAuthenticatedRequest(url, options = {}) {
    const defaultOptions = {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
      credentials: "include",
    };

    // Merge options (body etc. from options should override defaults)
    const finalOptions = { ...defaultOptions, ...options };

    this.log("Making authenticated request:", url, finalOptions);

    // Use background script to make the request
    const response = await chrome.runtime.sendMessage({
      type: "API_REQUEST",
      data: {
        url,
        ...finalOptions,
      },
    });

    if (!response?.success) {
      throw new Error(response?.error || "API request failed");
    }

    // Convert response to resemble fetch response
    return {
      ok: true,
      json: async () => response.data,
      text: async () => JSON.stringify(response.data),
    };
  }

  // ===== UPDATE detectIntent to use store =====
  detectIntent(text, context) {
    // Get context from store if not provided
    if (!context) {
      context = this.store.get("context");
    }

    if (context?.isGmail || context?.sourceType === "gmail") {
      return "email-reply";
    }
    if (context?.isGoogleDocs || context?.sourceType === "docs") {
      return "doc-actions";
    }
    if (context?.sourceType === "calendar") {
      return "calendar-actions";
    }
    return "general";
  }

  getLastUserIntent() {
    // Get from store
    return this.store.get("chat.lastUserIntent") || this.lastUserIntent;
  }

  /**
   * Send a message - Update to use store
   */
  async sendMessage(text, context = null) {
    if (!this.isInitialized) {
      throw new Error("ChatController not initialized");
    }

    // Detect and store intent
    const intent = this.detectIntent(text, context);
    this.store.set("chat.lastUserIntent", intent);
    this.store.set("chat.currentIntent", intent);

    this.log("Detected intent:", intent);

    // Generate session ID if needed
    if (!this.store.get("chat.sessionId")) {
      const newSessionId = this.generateChatId();
      this.store.set("chat.sessionId", newSessionId);
    }

    // Build message content (combine context into the content field)
    let finalContent = text;
    if (context && (context.mainContent || context.selectedText)) {
      const contextContent = context.selectedText || context.mainContent;
      let contextLabel = "[Kontext]";

      if (context.isGmail) {
        contextLabel = "[Email-Kontext]";
      } else if (context.isGoogleDocs) {
        contextLabel = "[Dokument-Kontext]";
      } else if (context.url?.includes("sharepoint")) {
        contextLabel = "[SharePoint-Kontext]";
      } else if (context.selectedText) {
        contextLabel = "[Ausgewählter Text]";
      } else {
        contextLabel = "[Webseiten-Kontext]";
      }

      finalContent = `${contextLabel}\n${contextContent}\n\n[Benutzer-Anfrage]\n${text}`;
      this.log("Combined content length:", finalContent.length);
    }

    // Create user message
    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: "user",
      content: finalContent, // ← includes context if provided
      timestamp: Date.now(),
      references: [],
      sources: [],
      _originalText: text, // for UI display
      _context: context, // raw context for UI
    };

    // ===== NEW: Add message via store =====
    const messages = [...(this.store.get("chat.messages") || []), userMessage];
    this.store.set("chat.messages", messages);

    try {
      // Set streaming state
      this.store.set("chat.isStreaming", true);

      const domain =
        this.store.get("auth.domain") || this.store.get("auth.activeDomain");
      if (!domain) {
        throw new Error("No domain configured");
      }

      const chatPayload = {
        id: this.store.get("chat.sessionId"),
        folderId: this.store.get("chat.folderId"),
        messages: this.store.get("chat.messages").map((msg) => ({
          role: msg.role,
          content: msg.content, // includes context
          references: msg.references || [],
          sources: msg.sources || [],
        })),
        model: this.model,
        name: "Neuer Chat",
        roleId: this.store.get("chat.roleId"),
        selectedAssistantId: "",
        selectedDataCollections: [],
        selectedFiles: [],
        selectedMode: "BASIC",
        temperature: 0.2,
      };

      this.log("Sending to API with state from store");

      // Make chat API request
      const chatUrl = `https://${domain}.506.ai/api/qr/chat`;
      this.log("Sending to chat API:", chatUrl);

      const response = await this.makeAuthenticatedRequest(chatUrl, {
        method: "POST",
        body: JSON.stringify(chatPayload),
      });

      const responseText = await response.text();
      this.log("Chat API response:", responseText);

      // Parse response (it might be plain text or JSON)
      let assistantContent;
      try {
        const jsonResponse = JSON.parse(responseText);
        assistantContent =
          jsonResponse.content || jsonResponse.message || responseText;
      } catch {
        assistantContent = responseText;
      }

      // Create assistant message
      const assistantMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        references: [],
        sources: [],
      };

      // ===== NEW: Update store with assistant message =====
      const updatedMessages = [
        ...this.store.get("chat.messages"),
        assistantMessage,
      ];
      this.store.set("chat.messages", updatedMessages);

      this.log("Assistant response added to store");

      return assistantMessage;
    } catch (error) {
      console.error("[ChatController] Send message failed:", error);

      // Remove the failed user message from store
      const revertedMessages = this.store.get("chat.messages").slice(0, -1);
      this.store.set("chat.messages", revertedMessages);

      // Add error to store
      this.store.actions.showError(
        "Failed to send message: " + (error?.message || String(error))
      );

      throw error;
    } finally {
      this.store.set("chat.isStreaming", false);
    }
  }

  /**
   * Build context string from page context (kept for debugging/analysis)
   */
  buildContextString(context) {
    console.log("[ChatController] === CONTEXT STRING BUILDING START ===");
    console.log("[ChatController] Input context keys:", Object.keys(context));
    console.log(
      "[ChatController] Selected text length:",
      context.selectedText?.length || 0
    );
    console.log(
      "[ChatController] Main content length:",
      context.mainContent?.length || 0
    );
    console.log("[ChatController] URL:", context.url);
    console.log("[ChatController] Title:", context.title);

    const parts = [];

    if (context.selectedText) {
      const selectedTextPart = `[Kontext: Ausgewählter Text auf der Seite: "${context.selectedText}"]`;
      parts.push(selectedTextPart);
      console.log(
        "[ChatController] Added selected text context, length:",
        selectedTextPart.length
      );
    } else if (context.url && context.title) {
      const urlTitlePart = `[Kontext: Der Nutzer befindet sich auf ${context.url} mit dem Titel "${context.title}"]`;
      parts.push(urlTitlePart);
      console.log(
        "[ChatController] Added URL/title context, length:",
        urlTitlePart.length
      );
    }

    if (context.mainContent && !context.selectedText) {
      // NO TRUNCATION - include the full content
      const fullContentPart = `[Seiteninhalt (Vollständig): ${context.mainContent}]`;
      parts.push(fullContentPart);
      console.log(
        "[ChatController] Added FULL main content, length:",
        fullContentPart.length
      );
      console.log(
        "[ChatController] Full content preview (first 200 chars):",
        context.mainContent.substring(0, 200)
      );
      console.log(
        "[ChatController] Full content preview (last 200 chars):",
        context.mainContent.substring(
          Math.max(0, context.mainContent.length - 200)
        )
      );
    }

    const finalContextString = parts.join("\n");

    console.log("[ChatController] === CONTEXT STRING BUILDING COMPLETE ===");
    console.log("[ChatController] Total parts:", parts.length);
    console.log(
      "[ChatController] Final context string length:",
      finalContextString.length
    );
    console.log(
      "[ChatController] Final context preview (first 300 chars):",
      finalContextString.substring(0, 300)
    );

    return finalContextString;
  }

  /**
   * Clear chat history - Update to use store
   */
  async clearChat() {
    this.log("Clearing chat via store");

    // Use store action
    this.store.actions.clearChat();

    this.log("Chat cleared in store");
  }

  // Remove old storage methods - we're using the store now!
  async loadHistory() {
    // Deprecated - using store
    return this.store.get("chat.messages") || [];
  }

  async saveHistory() {
    // Deprecated - store handles persistence automatically
    this.log("History auto-saved via store");
  }

  /**
   * Setup message handlers for streaming responses
   */
  setupMessageHandlers() {
    // Listen for streaming updates from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "STREAMING_UPDATE") {
        this.handleStreamingUpdate(message.data);
      }
    });
  }

  /**
   * Handle streaming update from API
   */
  handleStreamingUpdate(data) {
    this.log("Streaming update:", data);

    // Emit update event for UI
    window.dispatchEvent(
      new CustomEvent("chatUpdate", {
        detail: data,
      })
    );
  }

  /**
   * Generate unique chat ID (UUID v4)
   */
  generateChatId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  }
}
