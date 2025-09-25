// sidepanel/modules/chat-controller.js - CLEANED VERSION
import { AnalysisMessage } from "./analysis-message.js";

export class ChatController {
  constructor() {
    // Use AppStore as single source of truth
    this.store = window.AppStore;

    // Controller state
    this.isInitialized = false;
    this.abortController = null;

    // CompanyGPT model config
    this.model = {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      maxLength: 950000,
      tokenLimit: 950000,
    };

    // Debug flag
    this.debug = true;

    // Setup state sync
    this.setupStateSync();
    this.analysisMessage = new AnalysisMessage(
      document.querySelector(".analysis-container")
    );
    this.multiStepAbortController = null;
  }

  /**
   * Debug logger
   */
  log(...args) {
    if (this.debug) {
      console.log("[ChatController]", ...args);
    }
  }

  setupStateSync() {
    console.log("[ChatController] Setting up state sync...");

    // We don't need to manually sync anymore - just read from store when needed
    // The store is our single source of truth
  }

  /**
   * Initialize the chat controller
   */
  async initialize() {
    this.log("Initializing with state management...");

    try {
      // Load folders and roles from CompanyGPT
      await this.loadFoldersAndRoles();

      // Load stored messages if any
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
      this.store.set("chat.initialized", true);

      this.log("Initialized successfully", {
        folderId: this.store.get("chat.folderId"),
        roleId: this.store.get("chat.roleId"),
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
   * Load folders and roles
   */
  async loadFoldersAndRoles() {
    this.log("Loading folders and roles...");

    try {
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

    const finalOptions = { ...defaultOptions, ...options };
    this.log("Making authenticated request:", url, finalOptions);

    const response = await chrome.runtime.sendMessage({
      type: "API_REQUEST",
      data: {
        url,
        ...finalOptions,
      },
    });

    if (!response?.success) {
      const error = response?.error || "API request failed";

      // Check for server errors (5xx) OR permission errors (403)
      if (
        error.includes("500") ||
        error.includes("502") ||
        error.includes("503") ||
        error.includes("403") ||
        error.includes("ERR_BAD_REQUEST")
      ) {
        const serverError = new Error("SERVER_UNAVAILABLE");
        serverError.isServerError = true;
        serverError.originalError = error;
        throw serverError;
      }

      throw new Error(error);
    }

    return {
      ok: true,
      json: async () => response.data,
      text: async () => JSON.stringify(response.data),
    };
  }

  detectIntent(text, context) {
    // Get context from store if not provided
    if (!context) {
      context = this.store.get("context");
    }

    const lowerText = text?.toLowerCase() || "";

    // Check for ANY email context (Gmail, Outlook, or generic email)
    if (
      context?.isEmail ||
      context?.isGmail ||
      context?.isOutlook ||
      context?.emailProvider
    ) {
      // If we have email context, check if user wants to reply
      if (
        lowerText.includes("beantworte") ||
        lowerText.includes("antwort") ||
        lowerText.includes("reply") ||
        lowerText.includes("email")
      ) {
        return "email-reply";
      }
      // Even without explicit keywords, if it's email context, assume email-reply
      return "email-reply";
    }

    // Keep your existing checks
    if (context?.isGoogleDocs || context?.sourceType === "docs") {
      return "doc-actions";
    }

    if (context?.sourceType === "calendar") {
      return "calendar-actions";
    }

    return "general";
  }

  getLastUserIntent() {
    return this.store.get("chat.lastUserIntent");
  }

  // Add new method for multi-step Datenspeicher reply
  async sendDatanspeicherReply(query, context, folderId, folderName) {
    console.log("[ChatController] Starting multi-step Datenspeicher reply");

    // Initialize analysis message handler
    const messagesContainer = document.getElementById("chat-messages");
    this.analysisMessage = new AnalysisMessage(messagesContainer);

    // Set up multi-step process in store
    this.store.set("chat.multiStepProcess", {
      active: true,
      type: "email-datenspeicher-reply",
      currentStep: 1,
      totalSteps: 3,
      canAbort: true,
      abortController: new AbortController(),
      steps: [
        { step: 1, status: "running", result: null },
        { step: 2, status: "pending", result: null },
        { step: 3, status: "pending", result: null },
      ],
    });

    this.multiStepAbortController = new AbortController();
    this.analysisMessage.abortController = this.multiStepAbortController;

    try {
      // Check for abort after each step
      const checkAbort = () => {
        if (this.multiStepAbortController.signal.aborted) {
          throw new Error("Aborted");
        }
      };

      // STEP 1: Extract Query
      const step1El = this.analysisMessage.showStep(
        1,
        3,
        "Analysiere die Email..."
      );
      checkAbort();

      const extractedQuery = await this.extractEmailQuery(context);
      checkAbort();

      this.store.set("chat.extractedQuery", extractedQuery);
      this.analysisMessage.showQueryBubble(step1El, extractedQuery);

      // STEP 2: RAG Search
      const step2El = this.analysisMessage.showStep(
        2,
        3,
        `Durchsuche ${folderName}...`
      );
      checkAbort();

      const ragResults = await this.searchDatanspeicher(
        extractedQuery,
        folderId
      );
      checkAbort();

      this.store.set("chat.ragResults", ragResults);
      const entriesCount = Array.isArray(ragResults) ? ragResults.length : 1;
      this.analysisMessage.showRAGResults(step2El, ragResults, entriesCount);

      // STEP 3: Generate Reply
      const step3El = this.analysisMessage.showStep(
        3,
        3,
        "Erstelle Email-Antwort..."
      );
      checkAbort();

      const emailReply = await this.generateEmailReply(context, ragResults);
      checkAbort();

      // Update step 3 to complete
      this.analysisMessage.updateStepResult(step3El, "", "complete");

      // Remove analysis messages and show final result
      this.analysisMessage.removeAnalysisMessages();

      // Return the final response
      return {
        content: emailReply,
        intent: "email-reply", // So action buttons appear
      };
    } catch (error) {
      if (error.message === "Aborted") {
        console.log("[ChatController] Process aborted by user");
        return null;
      }

      console.error("[ChatController] Multi-step process failed:", error);
      this.analysisMessage.cleanup();
      throw error;
    } finally {
      // Reset multi-step process
      this.store.set("chat.multiStepProcess.active", false);
      this.multiStepAbortController = null;
    }
  }

  // Add method to extract query from email
  async extractEmailQuery(context) {
    console.log("[ChatController] Extracting query from email");

    const prompt = `Analysiere diese Email und extrahiere die Suchbegriffe.
  Formuliere eine präzise Suchanfrage mit den wichtigsten Begriffen.
  Verbinde mehrere Themen mit "UND".
  Antworte NUR mit der Suchanfrage, keine Erklärung.

  Beispiel: "Öffnungszeiten Sonntag UND Probetraining"

  Email:
  ${context.content || context.mainContent}

  Suchanfrage:`;

    // Use BASIC mode for extraction
    const response = await this.sendMessage(prompt, null, null);

    // Extract just the query from response
    let query = response.content;
    // Clean up the query (remove quotes, extra whitespace, etc)
    query = query.replace(/^["']|["']$/g, "").trim();

    return query;
  }

  // Add method to search Datenspeicher
  async searchDatanspeicher(query, folderId) {
    console.log("[ChatController] Searching Datenspeicher with query:", query);

    // Use QA mode with the extracted query
    const response = await this.sendMessage(query, null, folderId);

    return response.content;
  }

  // Add method to generate email reply
  async generateEmailReply(originalContext, ragResults) {
    console.log("[ChatController] Generating email reply");

    const prompt = `Schreibe eine professionelle und freundliche Email-Antwort.

  GEFUNDENE INFORMATIONEN:
  ${ragResults}

  ORIGINALE EMAIL:
  ${originalContext.content || originalContext.mainContent}

  Anweisungen:
  - Beantworte alle Fragen vollständig mit den gefundenen Informationen
  - Sei freundlich und professionell
  - Verwende die korrekte Anrede wenn der Name bekannt ist
  - Schließe mit einem freundlichen Gruß
  - Formatiere als komplette Email-Antwort

  Email-Antwort:`;

    // Use BASIC mode for generation
    const response = await this.sendMessage(prompt, null, null);

    return response.content;
  }

  /**
   * Send a message
   */
  // In chat-controller.js
  async sendMessage(message, context = null, explicitIntent = null) {
    console.log("[ChatController] === SENDING MESSAGE ===");
    console.log("[ChatController] Text:", message);
    console.log("[ChatController] Context:", context);
    console.log("[ChatController] Explicit Intent:", explicitIntent);

    if (!this.isInitialized) {
      throw new Error("ChatController not initialized");
    }

    // Use explicit intent if provided, otherwise detect it
    let intent = explicitIntent || this.detectIntent(message, context);

    // Preserve your variation override behavior (optional but useful)
    if (!explicitIntent && context?.isVariationRequest) {
      intent = "email-reply";
      console.log(
        "[ChatController] Variation request detected, forcing email-reply intent"
      );
    }

    // Store the intent
    this.store.set("chat.currentIntent", intent);
    this.store.set("chat.lastUserIntent", intent);
    console.log("[ChatController] Using intent:", intent);

    // Generate session ID if needed
    if (!this.store.get("chat.sessionId")) {
      const newSessionId = this.generateChatId();
      this.store.set("chat.sessionId", newSessionId);
    }

    // Build message content (combine context into the content field)
    let finalContent = message;
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

      finalContent = `${contextLabel}\n${contextContent}\n\n[Benutzer-Anfrage]\n${message}`;
      this.log("Combined content length:", finalContent.length);
    }

    // Create user message
    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: "user",
      content: finalContent,
      timestamp: Date.now(),
      references: [],
      sources: [],
      _originalText: message,
      _context: context,
    };

    // Get current messages and add new one
    const currentMessages = this.store.get("chat.messages") || [];
    const messagesWithNewOne = [...currentMessages, userMessage];

    // Update store IMMEDIATELY
    this.store.set("chat.messages", messagesWithNewOne);

    try {
      // Set streaming state
      this.store.set("chat.isStreaming", true);

      const domain =
        this.store.get("auth.domain") || this.store.get("auth.activeDomain");
      if (!domain) {
        throw new Error("No domain configured");
      }

      // Determine selected data collection from context or store
      const selectedDataCollection =
        context?.selectedDataCollection ||
        this.store.get("chat.selectedDataCollection") ||
        null;

      // Determine mode based on whether we're using Datenspeicher
      const mode = selectedDataCollection ? "QA" : "BASIC";

      console.log("[ChatController] Using mode:", mode);
      console.log(
        "[ChatController] Data collections:",
        selectedDataCollection ? [selectedDataCollection] : []
      );

      // Build payload with the correct mode and data collections
      const chatPayload = {
        id: this.store.get("chat.sessionId"),
        folderId: this.store.get("chat.folderId"),
        messages: messagesWithNewOne.map((msg) => ({
          role: msg.role,
          content: msg.content,
          references: msg.references || [],
          sources: msg.sources || [],
        })),
        model: this.model,
        name: "Neuer Chat",
        roleId: this.store.get("chat.roleId"),
        selectedAssistantId: "",
        selectedDataCollections: selectedDataCollection
          ? [selectedDataCollection]
          : [],
        selectedFiles: [],
        selectedMode: mode, // Dynamic mode based on Datenspeicher usage
        temperature: 0.2,
        // optional: you could include intent here if your backend supports it
        // intent,
      };

      console.log("[ChatController] === PAYLOAD DEBUG ===");
      console.log("[ChatController] Mode:", chatPayload.selectedMode);
      console.log(
        "[ChatController] Data Collections:",
        chatPayload.selectedDataCollections
      );
      console.log(
        "[ChatController] Payload message count:",
        chatPayload.messages.length
      );

      // Make chat API request
      const chatUrl = `https://${domain}.506.ai/api/qr/chat`;
      this.log("Sending to chat API:", chatUrl);

      const response = await this.makeAuthenticatedRequest(chatUrl, {
        method: "POST",
        body: JSON.stringify(chatPayload),
      });

      const responseText = await response.text();
      this.log("Chat API response:", responseText);

      // Parse response
      let assistantContent;
      try {
        const jsonResponse = JSON.parse(responseText);
        assistantContent =
          jsonResponse.content || jsonResponse.message || responseText;
      } catch {
        assistantContent = responseText;
      }

      // Create assistant message with metadata about data collection usage
      const assistantMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        references: [],
        sources: [],
        _usedDataCollection: selectedDataCollection, // Track what was used
        _mode: mode,
      };

      // Get fresh messages from store and add assistant response
      const updatedMessages = [
        ...this.store.get("chat.messages"),
        assistantMessage,
      ];
      this.store.set("chat.messages", updatedMessages);

      console.log("[ChatController] Response added with mode:", mode);
      this.log("Assistant response added to store");

      return assistantMessage;
    } catch (error) {
      console.error("[ChatController] Send message failed:", error);

      // If the backend flagged this as a server-side availability issue,
      // add a fallback assistant message instead of reverting the user message.
      if (error.isServerError) {
        console.log(
          "[ChatController] Server is unavailable, returning fallback message"
        );

        const fallbackMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: "assistant",
          content:
            "⚠️ Fehlerhafte Antwort vom Sprachmodell. Der Server ist momentan nicht erreichbar. Bitte versuche es später erneut.",
          timestamp: Date.now(),
          references: [],
          sources: [],
          _isError: true,
          _errorType: "server_unavailable",
        };

        const updatedMessages = [
          ...this.store.get("chat.messages"),
          fallbackMessage,
        ];
        this.store.set("chat.messages", updatedMessages);

        // Return the fallback so the UI can display it
        return fallbackMessage;
      }

      // For other errors, revert the failed user message
      this.store.set("chat.messages", currentMessages);
      this.store.actions.showError(
        "Failed to send message: " + (error?.message || String(error))
      );
      throw error;
    } finally {
      this.store.set("chat.isStreaming", false);
    }
  }

  /**
   * Clear chat history
   */
  async clearChat() {
    this.log("Clearing chat via store");

    // Use store action
    this.store.actions.clearChat();

    this.log("Chat cleared in store");
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
