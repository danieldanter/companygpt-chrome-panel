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

    const domain =
      this.store.get("auth.domain") || this.store.get("auth.activeDomain");
    if (!domain) {
      console.error(
        "[ChatController] No domain configured. Please ensure you're logged in."
      );
      return; // don't throw—just stop gracefully
    }

    this.log("Using domain from store:", domain);

    // Helper: retry wrapper with exponential backoff for 401/temporary errors
    const fetchWithRetry = async (
      url,
      { attempts = 3, baseDelayMs = 800 } = {}
    ) => {
      let lastErr;
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await this.makeAuthenticatedRequest(url);

          if (!res.ok) {
            // Treat 401/429/5xx as retryable
            if (
              [401, 429, 500, 502, 503, 504].includes(res.status) &&
              i < attempts - 1
            ) {
              const delay = baseDelayMs * Math.pow(2, i); // backoff: 0.8s, 1.6s, 3.2s
              this.log(
                `Request to ${url} failed with ${res.status}. Retrying in ${delay}ms...`
              );
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }
            // Non-retryable or last attempt
            const text = await res.text().catch(() => "");
            const err = new Error(
              `HTTP ${res.status} for ${url}${text ? ` – ${text}` : ""}`
            );
            err.status = res.status;
            throw err;
          }

          // Safe JSON
          let data;
          try {
            data = await res.json();
          } catch (e) {
            const text = await res.text().catch(() => "");
            throw new Error(
              `Invalid JSON from ${url}${
                text ? ` – body: ${text.slice(0, 300)}…` : ""
              }`
            );
          }

          return data;
        } catch (err) {
          lastErr = err;
          // Only backoff on retryable errors; message already handled above for http statuses
          if (i < attempts - 1) {
            const delay = baseDelayMs * Math.pow(2, i);
            this.log(
              `Error calling ${url}: ${
                err?.message || err
              }. Retrying in ${delay}ms...`
            );
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }
      throw lastErr;
    };

    try {
      // -------- Load folders --------
      const foldersUrl = `https://${domain}.506.ai/api/folders`;
      this.log("Fetching folders from:", foldersUrl);
      const foldersData = await fetchWithRetry(foldersUrl);

      this.log("Folders response:", foldersData);

      const rootChatFolder = foldersData?.folders?.find?.(
        (f) => f?.type === "ROOT_CHAT"
      );
      if (!rootChatFolder) {
        console.warn("[ChatController] No ROOT_CHAT folder found.");
      } else {
        this.store.set("chat.folderId", rootChatFolder.id);
        this.log("Found ROOT_CHAT folder:", {
          id: rootChatFolder.id,
          name: rootChatFolder.name,
        });
      }

      // -------- Load roles --------
      const rolesUrl = `https://${domain}.506.ai/api/roles`;
      this.log("Fetching roles from:", rolesUrl);
      const rolesData = await fetchWithRetry(rolesUrl);

      this.log("Roles response:", rolesData);

      const roles = rolesData?.roles || [];
      let chosenRole = roles.find((r) => r?.defaultRole === true) || roles[0];

      if (!chosenRole) {
        console.warn("[ChatController] No roles available.");
      } else {
        // Some APIs use id vs roleId—support both
        const roleId = chosenRole.roleId ?? chosenRole.id;
        this.store.set("chat.roleId", roleId);
        this.log(
          chosenRole.defaultRole
            ? "Found default role:"
            : "No default role found, using first role:",
          {
            id: roleId,
            name: chosenRole.name,
          }
        );
      }
    } catch (error) {
      console.error("[ChatController] Failed to load folders/roles:", error);
      // Don't throw—log and continue so the app can degrade gracefully
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

    // FIRST: Check if we have a preserved intent from Datenspeicher or explicit action
    const preservedIntent = this.store.get("chat.currentIntent");

    // If we're in an email context and have a preserved email-reply intent, keep it
    if (preservedIntent === "email-reply" && context) {
      const isEmailContext =
        context?.isEmail ||
        context?.isGmail ||
        context?.isOutlook ||
        context?.emailProvider;

      if (isEmailContext) {
        console.log(
          "[ChatController] Preserving email-reply intent for email context"
        );
        return "email-reply";
      }
    }

    // --- Rest of existing detectIntent logic ---
    const lowerText = text?.toLowerCase() || "";

    // Check for ANY email context (Gmail, Outlook, or generic email)
    if (
      context?.isEmail ||
      context?.isGmail ||
      context?.isOutlook ||
      context?.emailProvider
    ) {
      // Only return email-reply if user explicitly asks for email action
      if (
        lowerText.includes("beantworte") ||
        lowerText.includes("antwort") ||
        lowerText.includes("reply") ||
        lowerText.includes("email") ||
        (lowerText.includes("schreibe") && lowerText.includes("mail"))
      ) {
        return "email-reply";
      }
      // No automatic fallback to email-reply — fall through
    }

    // Other contexts
    if (context?.isGoogleDocs || context?.sourceType === "docs") {
      return "doc-actions";
    }

    if (context?.sourceType === "calendar") {
      return "calendar-actions";
    }

    return "general"; // Default for everything else
  }

  getLastUserIntent() {
    return this.store.get("chat.lastUserIntent");
  }

  // Add new method for multi-step Datenspeicher reply
  async sendDatanspeicherReply(
    query,
    context,
    folderId,
    folderName,
    explicitIntent = null
  ) {
    console.log("[ChatController] Starting multi-step Datenspeicher reply");
    console.log("[ChatController] Explicit intent:", explicitIntent);

    // Preserve the intent throughout the process
    const originalIntent =
      explicitIntent || this.store.get("chat.lastUserIntent");

    // Ensure intent stays set
    if (originalIntent) {
      this.store.set("chat.currentIntent", originalIntent);
      this.store.set("chat.lastUserIntent", originalIntent);
    }

    const messagesContainer = document.getElementById("chat-messages");
    this.analysisMessage = new AnalysisMessage(messagesContainer);

    // Track process data for the collapsible card
    const processData = {
      id: `process-${Date.now()}`,
      folderName: folderName,
      steps: [],
      timestamp: Date.now(),
    };

    try {
      // STEP 1: Show and start
      const step1El = this.analysisMessage.showStep(
        1,
        3,
        "Analysiere die Email..."
      );

      // Do the actual work
      const extractedQuery = await this.extractEmailQuery(context);

      // Optional: show a nice bubble within the step
      this.analysisMessage.showQueryBubble(step1El, extractedQuery);

      // Complete step 1 with results
      this.analysisMessage.completeStep(
        1,
        "Email analysiert",
        `Suchanfrage: "${extractedQuery}"`
      );

      // Track process data
      processData.steps.push({
        text: "Email analysiert",
        detail: `Suchanfrage: "${extractedQuery}"`,
      });

      // Small delay before next step for visual clarity
      await new Promise((resolve) => setTimeout(resolve, 300));

      // STEP 2: RAG Search
      const step2El = this.analysisMessage.showStep(
        2,
        3,
        `Durchsuche ${folderName}...`
      );
      const ragResults = await this.searchDatanspeicher(
        extractedQuery,
        folderId
      );

      const entriesCount = Array.isArray(ragResults) ? ragResults.length : 1;

      // Format the RAG results for display
      let ragResultsPreview = "";
      if (typeof ragResults === "string") {
        ragResultsPreview =
          ragResults.substring(0, 200) + (ragResults.length > 200 ? "..." : "");
      } else if (Array.isArray(ragResults)) {
        ragResultsPreview = ragResults
          .slice(0, 2)
          .map((item) =>
            typeof item === "string"
              ? item
              : item.content || JSON.stringify(item)
          )
          .join("\n");
      }

      // Store the step with the actual data as detail
      processData.steps.push({
        text: `${entriesCount} relevante Einträge gefunden`,
        detail: ragResultsPreview,
      });

      // Store count at top level too
      processData.entriesCount = entriesCount;

      // Complete the step and show the results
      this.analysisMessage.completeStep(
        2,
        `${entriesCount} relevante Einträge gefunden`,
        ragResultsPreview
      );

      await new Promise((resolve) => setTimeout(resolve, 300));

      // STEP 3: Show and start
      const step3El = this.analysisMessage.showStep(
        3,
        3,
        "Erstelle Email-Antwort..."
      );

      // Generate reply
      const emailReply = await this.generateEmailReply(context, ragResults);

      // Complete step 3
      this.analysisMessage.completeStep(3, "Antwort generiert", null);

      // Track process data
      processData.steps.push({
        text: "Antwort generiert",
        detail: null,
      });

      // Wait a moment before collapsing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Remove the temporary analysis messages
      this.analysisMessage.removeAnalysisMessages();

      // Add the collapsible process message to chat (excluded from API payloads)
      const processMessage = {
        id: processData.id,
        role: "process",
        content: processData,
        timestamp: Date.now(),
        _isProcessMessage: true,
        _processData: processData,
      };

      const currentMessages = this.store.get("chat.messages") || [];
      this.store.set("chat.messages", [...currentMessages, processMessage]);

      // IMPORTANT: Return with preserved intent
      return {
        content: emailReply,
        intent: originalIntent || "email-reply",
        processData: processData,
      };
    } catch (error) {
      if (error.message === "Aborted") {
        console.log("[ChatController] Process aborted by user");
        return null;
      }
      throw error;
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

    const result = await this.makeIsolatedQuery(prompt, "BASIC");
    return result.replace(/^["']|["']$/g, "").trim();
  }

  async makeIsolatedQuery(content, mode = "BASIC", folderId = null) {
    const domain =
      this.store.get("auth.domain") || this.store.get("auth.activeDomain");

    const payload = {
      id: this.generateChatId(),
      folderId: this.store.get("chat.folderId"),
      messages: [
        {
          // Just ONE message, no history
          role: "user",
          content: content,
          timestamp: Date.now(),
          references: [],
          sources: [],
        },
      ],
      model: this.model,
      name: "Isolated Query",
      roleId: this.store.get("chat.roleId"),
      selectedAssistantId: "",
      selectedDataCollections: folderId ? [folderId] : [],
      selectedFiles: [],
      selectedMode: mode,
      temperature: 0.2,
    };

    const response = await this.makeAuthenticatedRequest(
      `https://${domain}.506.ai/api/qr/chat`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );

    const responseText = await response.text();
    try {
      const jsonResponse = JSON.parse(responseText);
      return jsonResponse.content || jsonResponse.message || responseText;
    } catch {
      return responseText;
    }
  }

  async searchDatanspeicher(query, folderId) {
    console.log("[ChatController] Searching Datenspeicher with query:", query);
    console.log("[ChatController] Using folder ID:", folderId);

    return await this.makeIsolatedQuery(query, "QA", folderId);
  }

  // Add method to generate email reply
  async generateEmailReply(originalContext, ragResults) {
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

    return await this.makeIsolatedQuery(prompt, "BASIC");
  }

  /**
   * Send a message
   */
  // In chat-controller.js
  // In chat-controller.js, replace the entire sendMessage method (starts around line 490)

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

      // ===== FIX STARTS HERE =====
      // Determine selected data collection from context or store
      const selectedDataCollection =
        context?.selectedDataCollection || // Check if passed in context
        this.store.get("chat.selectedDataCollection") ||
        null;

      // Determine mode based on whether we're using Datenspeicher
      const mode = selectedDataCollection ? "QA" : "BASIC";

      console.log("[ChatController] Using mode:", mode);
      console.log(
        "[ChatController] Selected data collection:",
        selectedDataCollection
      );
      console.log(
        "[ChatController] Data collections array:",
        selectedDataCollection ? [selectedDataCollection] : []
      );
      // ===== FIX ENDS HERE =====

      // Build payload with the correct mode and data collections
      const chatPayload = {
        id: this.store.get("chat.sessionId"),
        folderId: this.store.get("chat.folderId"),
        messages: messagesWithNewOne
          .filter((msg) => !msg._isProcessMessage) // Filter out process messages!
          .map((msg) => ({
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
