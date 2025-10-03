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
      // Use APIService for folders
      const foldersData = await window.APIService.fetchFolders();
      this.log("Folders response:", foldersData);

      const rootChatFolder = foldersData?.folders?.find(
        (f) => f?.type === "ROOT_CHAT"
      );

      if (rootChatFolder) {
        this.store.set("chat.folderId", rootChatFolder.id);
        this.log("Found ROOT_CHAT folder:", rootChatFolder);
      }

      // Use APIService for roles
      const rolesData = await window.APIService.fetchRoles();
      this.log("Roles response:", rolesData);

      const roles = rolesData?.roles || [];
      const chosenRole = roles.find((r) => r?.defaultRole === true) || roles[0];

      if (chosenRole) {
        const roleId = chosenRole.roleId ?? chosenRole.id;
        this.store.set("chat.roleId", roleId);
        this.log("Set role:", chosenRole);
      }
    } catch (error) {
      console.warn(
        "[ChatController] Failed to load folders/roles (non-critical):",
        error.message
      );
      // Don't throw - these aren't critical for basic chat functionality
    }
  }

  /**
   * Make authenticated request with cookies
   */
  async makeAuthenticatedRequest(url, options = {}) {
    this.log("Making authenticated request:", url, options);

    try {
      // Debug what we're receiving
      console.log("[ChatController] Options body:", options.body);

      // Extract the payload from options
      const payload = options.body ? JSON.parse(options.body) : {};

      console.log("[ChatController] Parsed payload:", payload);
      console.log("[ChatController] Payload keys:", Object.keys(payload));

      const response = await window.APIService.sendChatMessage(payload);

      return {
        ok: true,
        json: async () => response,
        text: async () => JSON.stringify(response),
      };
    } catch (error) {
      this.log("Request failed:", error);

      // Keep the same error handling
      const errorMessage = error.message || error.toString();
      if (
        errorMessage.includes("500") ||
        errorMessage.includes("502") ||
        errorMessage.includes("503") ||
        errorMessage.includes("403") ||
        errorMessage.includes("ERR_BAD_REQUEST")
      ) {
        const serverError = new Error("SERVER_UNAVAILABLE");
        serverError.isServerError = true;
        serverError.originalError = errorMessage;
        throw serverError;
      }
      throw error;
    }
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
      this.analysisMessage.completeStep(1, "Email analysiert", extractedQuery);

      // Track process data
      processData.steps.push({
        text: "Email analysiert",
        detail: extractedQuery,
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

    const prompt = `### Rolle ###
Du bist ein KI-System-Analyst, der darauf spezialisiert ist, Nutzeranfragen in effiziente Suchabfragen für eine Wissensdatenbank (RAG-System) umzuwandeln. Du bist präzise, technisch und verstehst den Unterschied zwischen semantischer Suche und Keyword-Suche.

### Aufgabe ###
Deine Aufgabe ist es, eine E-Mail-Anfrage zu analysieren und daraus eine klar strukturierte Textausgabe zu generieren, die eine optimale Abfrage für ein duales Suchsystem (semantisch + Keyword) darstellt.

### Analyseprozess ###
1. **Identifiziere die Kernabsicht:** Was ist die zentrale Frage oder das Hauptproblem des Nutzers? Ignoriere Füllwörter und Höflichkeitsfloskeln.
2. **Formuliere eine semantische Abfrage:** Formuliere aus der Kernabsicht eine klare, prägnante Frage oder eine kurze Aussage. Diese Abfrage wird für eine Vektor- bzw. Ähnlichkeitssuche verwendet. Sie sollte den Sinn der Anfrage erfassen.
3. **Extrahiere kritische Keywords:** Identifiziere die 3-5 wichtigsten Substantive, technischen Begriffe, Eigennamen oder Entitäten aus der E-Mail.
4. **Normalisiere die Keywords:** Wandle die extrahierten Begriffe in ihre Grundform oder eine kanonische Form um (z.B. Singular statt Plural, englische Fachbegriffe, falls üblich).

### Ausgabeformat ###
Deine Ausgabe muss **ausschließlich** aus **exakt zwei Zeilen** bestehen.
- **Zeile 1:** Enthält die für die semantische Suche optimierte Frage oder Aussage.
- **Zeile 2:** Enthält eine kommagetrennte Liste der normalisierten Keywords (ohne Leerzeichen nach dem Komma).

Füge keine weiteren Erklärungen, Titel oder leere Zeilen vor, zwischen oder nach den beiden Zeilen hinzu.

### Beispiele ###
**Beispiel 1:**
**E-Mail-Input:**
"""
hallo
ich verwende den upload media endpunkt und versuche viele dateien upzuloaden
mir ist allerdings aufgefallen, dass es anscheinend ein bestimmtes rate limit gibt
wie hoch ist dieses aktuell?
"""

**Dein Text-Output:**
Wie hoch ist das Rate Limit für den Upload Media Endpunkt?
upload media,endpoint,rate limit,limit,beschränkung

**Beispiel 2:**
**E-Mail-Input:**
"""
Servus, ich hab ein Problem mit dem Login. Immer wenn ich versuche, mich mit meinem Google Account anzumelden, kriege ich einen 401-Fehler. Woran kann das liegen?
"""

**Dein Text-Output:**
Fehlerursachen für 401-Fehler beim Google-Login
login,google account,anmeldung,401,authentifizierung

### E-Mail-Input ###
"""
${context.content || context.mainContent}
"""

### Dein Text-Output ###`;

    const result = await this.makeIsolatedQuery(prompt, "BASIC");

    // Clean up the result
    let cleanedResult = result
      .replace(/^["']|["']$/g, "") // Remove surrounding quotes
      .replace(/\\n/g, "\n") // Replace literal \n with actual newlines
      .replace(/^Suchanfrage:\s*/i, "") // Remove "Suchanfrage:" prefix if present
      .replace(/^"Suchanfrage:\s*/i, "") // Remove quoted "Suchanfrage:" prefix
      .trim();

    // Remove any duplicate "Suchanfrage:" patterns
    cleanedResult = cleanedResult.replace(/^Suchanfrage:\s*/gi, "");

    // Process the two-line output
    const lines = cleanedResult.split("\n").filter((line) => line.trim());

    console.log("[ChatController] Extracted lines:", lines);

    if (lines.length >= 2) {
      // Get semantic query and keywords
      const semanticQuery = lines[0].trim();
      const keywords = lines[1].trim();

      // Combine them for the search
      const combinedQuery = `${semanticQuery} ${keywords.replace(/,/g, " ")}`;

      console.log("[ChatController] Final query:", combinedQuery);

      return combinedQuery;
    } else if (lines.length === 1) {
      // If we only got one line, use it as is
      console.log("[ChatController] Single line query:", lines[0]);
      return lines[0].trim();
    } else {
      // Fallback: try to extract something meaningful from the original result
      console.warn("[ChatController] Unexpected format, using cleaned result");
      return cleanedResult || "Datenspeicher Suche";
    }
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

  extractSenderName(emailLines) {
    // Look for "Von:", "From:", or greeting patterns
    for (const line of emailLines) {
      if (line.includes("Von:") || line.includes("From:")) {
        const name = line.split(":")[1]?.trim().split(" ")[0];
        if (name) return name;
      }
      // Check for signature
      if (
        line.toLowerCase().includes("grüß") ||
        line.toLowerCase().includes("regards")
      ) {
        const nextLine = emailLines[emailLines.indexOf(line) + 1];
        if (nextLine && !nextLine.includes("@")) {
          return nextLine.trim().split(" ")[0];
        }
      }
    }
    return null;
  }

  async generateEmailReply(originalContext, ragResults) {
    // Extract sender name if possible
    const emailLines = (originalContext.content || "").split("\n");
    const senderName = this.extractSenderName(emailLines);

    // Get email settings - with correct paths
    const emailSenderName =
      this.store.get("settings.emailConfig.senderName") || "";
    const emailSignature =
      this.store.get("settings.emailConfig.signature") || "";

    // Check if signature contains HTML
    const hasHtmlSignature = /<[^>]+>/.test(emailSignature);
    const isGmail =
      originalContext.emailProvider === "gmail" || originalContext.isGmail;

    console.log("[ChatController] Email settings:", {
      emailSenderName,
      hasHtmlSignature,
      isGmail,
    });

    let signatureInstructions = "";
    if (emailSenderName || emailSignature) {
      if (hasHtmlSignature && isGmail) {
        // HTML signature for Gmail
        signatureInstructions = `
  
  **WICHTIGE SIGNATUR-ANWEISUNGEN:**
  ${
    emailSenderName ? `- Unterschreibe die Email mit: "${emailSenderName}"` : ""
  }
  - Füge NACH "Mit freundlichen Grüßen" diese HTML-formatierte Signatur EXAKT so ein:
${emailSignature}
  - WICHTIG: Behalte ALLE HTML-Tags (<b>, <i>, <br>, <a href="">) genau bei!
  - Die Signatur muss als HTML-Code erhalten bleiben, nicht als Text interpretiert werden`;
      } else {
        // Plain text signature
        signatureInstructions = `
  
  **WICHTIGE SIGNATUR-ANWEISUNGEN:**
  ${
    emailSenderName ? `- Unterschreibe die Email mit: "${emailSenderName}"` : ""
  }
  ${
    emailSignature
      ? `- Füge NACH "Mit freundlichen Grüßen" und dem Namen diese Signatur ein:
${emailSignature}`
      : ""
  }`;
      }
    }

    const prompt = `### Rolle
  Du bist ein Experte für professionelle schriftliche Kommunikation. Deine Stärke liegt darin, gegebene Informationen in klare, präzise und freundliche E-Mail-Antworten umzuwandeln. Du agierst stets souverän, kompetent und direkt im Namen des Absenders.
  Du kommunizierst klar, professionell und direkt.
  
  ### Aufgabe
  Deine primäre Aufgabe ist es, eine E-Mail-Anfrage eines Kunden fokussiert und präzise zu beantworten. Deine Antwort soll gezielt das Problem des Kunden lösen oder seine Frage beantworten, ohne unnötige Zusatzinformationen zu liefern.
  
  ### Dir bereitgestellte Informationen
  **Kunden-E-Mail:** 
  ${originalContext.content || originalContext.mainContent}
  
  **Wissensdatenbank-Auszug:** 
  ${ragResults}
  ${signatureInstructions}
  
  ### Verhaltensanweisungen & Regeln
  1. **Verinnerliche das Wissen**: Behandle die Informationen aus dem Wissensdatenbank-Auszug so, als wären es deine eigenen, langjährigen Kenntnisse. Du bist der Experte.
  
  2. **Verbot von Quellenangaben**: Es ist absolut entscheidend, dass du niemals erwähnst, dass du Informationen erhalten hast. Du darfst nicht auf den "Wissensdatenbank-Auszug", "die Dokumente" oder "bereitgestellte Informationen" verweisen.
  
  3. **Fokus und Relevanz**:
    - Identifiziere die zentrale Frage in der Kunden-E-Mail
    - Wähle aus dem Wissensdatenbank-Auszug nur die Informationen aus, die zur Beantwortung dieser spezifischen Frage absolut notwendig sind
    - Antworte so ausführlich wie nötig, aber so kurz und prägnant wie möglich
    - Dein Ziel ist es, dem Kunden schnell und effizient zu helfen, nicht, ihm dein gesamtes Wissen zu zeigen
  
  4. **Vermeide verräterische Phrasen**:
    FALSCH: "Die von Ihnen genannten Informationen zeigen, dass..."
    FALSCH: "Laut den Dokumenten wird WEBM nicht unterstützt."
    RICHTIG: "Das Dateiformat WEBM wird für diesen Endpunkt leider nicht unterstützt."
  
  5. **Struktur der Antwort**:
    - Verfasse eine vollständige E-Mail
    - Beginne mit einer freundlichen und passenden Anrede${
      senderName
        ? ` (verwende "${senderName}" falls passend)`
        : ' (z.B. "Sehr geehrte/r Herr/Frau [Nachname]," oder "Guten Tag,")'
    }
    - Schreibe den Hauptteil deiner Antwort
    - Beende die E-Mail mit "Mit freundlichen Grüßen"
    ${
      emailSenderName
        ? `- Unterschreibe direkt nach der Grußformel mit: ${emailSenderName}`
        : ""
    }
    ${
      hasHtmlSignature && isGmail
        ? "- Die HTML-Signatur MUSS mit allen Tags erhalten bleiben!"
        : ""
    }
  
  ### Ausgabe
  Schreibe NUR die fertige E-Mail-Antwort. ${
    hasHtmlSignature && isGmail
      ? "Behalte HTML-Formatierung bei wo angegeben."
      : "Keine Erklärungen, keine Metainformationen."
  } Nur der reine E-Mail-Text, den der Kunde erhalten soll.`;

    console.log(
      "[ChatController] Email will have HTML signature:",
      hasHtmlSignature && isGmail
    );

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
