// sidepanel/modules/chat-controller.js

export class ChatController {
  constructor() {
    // Chat state
    this.messages = [];
    this.currentContext = null;
    this.sessionId = null; // Will be generated on first message
    this.isInitialized = false;
    this.isStreaming = false;
    this.abortController = null;

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
  }

  /**
   * Debug logger
   */
  log(...args) {
    if (this.debug) {
      console.log("[ChatController]", ...args);
    }
  }

  /**
   * Initialize the chat controller
   */
  async initialize() {
    this.log("Initializing...");

    try {
      // Load folders and roles from CompanyGPT
      await this.loadFoldersAndRoles();

      // Load chat history from storage (if any)
      this.messages = await this.loadHistory();

      // Set up message handlers
      this.setupMessageHandlers();

      this.isInitialized = true;
      this.log("Initialized successfully", {
        folderId: this.folderId,
        roleId: this.roleId,
        messagesLoaded: this.messages.length,
      });

      return true;
    } catch (error) {
      console.error("[ChatController] Initialization failed:", error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Load folders and roles from CompanyGPT API
   */
  async loadFoldersAndRoles() {
    this.log("Loading folders and roles...");

    try {
      // Get domain from auth service
      const domain =
        window.AuthService?.getActiveDomain() || window.CONFIG?.DOMAIN;
      if (!domain) {
        throw new Error("No domain configured");
      }

      this.log("Using domain:", domain);

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

      this.folderId = rootChatFolder.id;
      this.log("Found ROOT_CHAT folder:", {
        id: this.folderId,
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
          this.roleId = firstRole.roleId;
          this.log("No default role found, using first role:", {
            id: this.roleId,
            name: firstRole.name,
          });
        } else {
          throw new Error("No roles available");
        }
      } else {
        this.roleId = defaultRole.roleId;
        this.log("Found default role:", {
          id: this.roleId,
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

    // Merge options
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

    if (!response.success) {
      throw new Error(response.error || "API request failed");
    }

    // Convert response to look like fetch response
    return {
      ok: true,
      json: async () => response.data,
      text: async () => JSON.stringify(response.data),
    };
  }

  /**
   * Send a message to the CompanyGPT API
   */
  async sendMessage(text, context = null) {
    if (!this.isInitialized) {
      throw new Error("ChatController not initialized");
    }

    if (this.isStreaming) {
      throw new Error("Already processing a message");
    }

    this.log("Sending message:", text);
    this.log("Context:", context);

    // Generate session ID for new chat
    if (!this.sessionId) {
      this.sessionId = this.generateChatId();
      this.log("Generated new chat ID:", this.sessionId);
    }

    // Build message content with context (only for first message)
    let messageContent = text;
    // To this (temporary for testing):
    if (context) {
      // Always add context if available
      // Add context to first message
      const contextString = this.buildContextString(context);
      if (contextString) {
        messageContent = `${text}\n\n${contextString}`;
        this.log("Enhanced message with context:", messageContent);
      }
    }

    // Create user message object
    const userMessage = {
      role: "user",
      content: messageContent,
      references: [],
      sources: [],
    };

    // Add to messages array
    this.messages.push(userMessage);

    try {
      this.isStreaming = true;

      // Get domain
      const domain =
        window.AuthService?.getActiveDomain() || window.CONFIG?.DOMAIN;
      if (!domain) {
        throw new Error("No domain configured");
      }

      // Build chat request payload
      const chatPayload = {
        id: this.sessionId,
        folderId: this.folderId,
        messages: this.messages,
        model: this.model,
        name: "Neuer Chat",
        roleId: this.roleId,
        selectedAssistantId: "",
        selectedDataCollections: [],
        selectedFiles: [],
        selectedMode: "BASIC",
        temperature: 0.2,
      };

      this.log("Chat API payload:", chatPayload);

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
        // Response is plain text
        assistantContent = responseText;
      }

      // Create assistant message
      const assistantMessage = {
        role: "assistant",
        content: assistantContent,
        references: [],
        sources: [],
      };

      this.messages.push(assistantMessage);
      await this.saveHistory();

      this.log("Assistant response added to history");

      return assistantMessage;
    } catch (error) {
      console.error("[ChatController] Send message failed:", error);

      // Remove the user message if request failed
      this.messages.pop();

      throw error;
    } finally {
      this.isStreaming = false;
    }
  }

  /**
   * Build context string from page context
   */
  /**
   * Build context string from page context
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
   * Clear chat history
   */
  async clearChat() {
    this.log("Clearing chat");

    this.messages = [];
    this.sessionId = null; // Generate new ID for next chat
    await this.saveHistory();

    this.log("Chat cleared");
  }

  /**
   * Load chat history from storage
   */
  async loadHistory() {
    try {
      const result = await chrome.storage.local.get([
        "chatHistory",
        "chatSessionId",
      ]);

      if (result.chatSessionId) {
        this.sessionId = result.chatSessionId;
        this.log("Restored session ID:", this.sessionId);
      }

      if (result.chatHistory) {
        // Only load history from the same day
        const today = new Date().toDateString();
        const history = result.chatHistory.filter((msg) => {
          const msgDate = new Date(msg.timestamp || Date.now()).toDateString();
          return msgDate === today;
        });

        this.log(`Loaded ${history.length} messages from history`);
        return history;
      }
    } catch (error) {
      console.error("[ChatController] Failed to load history:", error);
    }

    return [];
  }

  /**
   * Save chat history to storage
   */
  async saveHistory() {
    try {
      // Keep only last 50 messages
      const toSave = this.messages.slice(-50);

      await chrome.storage.local.set({
        chatHistory: toSave,
        chatSessionId: this.sessionId,
      });

      this.log("Saved", toSave.length, "messages to storage");
    } catch (error) {
      console.error("[ChatController] Failed to save history:", error);
    }
  }

  /**
   * Setup message handlers for streaming responses
   */
  setupMessageHandlers() {
    // Listen for streaming updates from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
