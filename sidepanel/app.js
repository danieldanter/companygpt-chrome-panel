// sidepanel/app.js
import { ChatController } from "./modules/chat-controller.js";
import { MessageRenderer } from "./modules/message-renderer.js";
import { ContextManager } from "./modules/context-manager.js";

class CompanyGPTChat {
  constructor() {
    // ===== NEW: Use AppStore =====
    this.store = window.AppStore;

    this.chatController = null;
    this.messageRenderer = null;
    this.contextAnalyzer = null;
    this.currentTabInfo = null;
    this.isInitialized = false;

    // OLD: Keep these for now (we'll remove later)
    this.isAuthenticated = false;
    this.authCheckInProgress = false;

    // Session/context management (kept minimal)
    this.lastKnownUrl = null;
    this.lastKnownDomain = null;
    this.sessionStartTime = null;

    // ContextManager instance
    this.contextManager = null;

    // Cache UI refs
    this.elements = {};

    // ===== NEW: Setup state subscriptions =====
    this.setupStateSubscriptions();
  }

  // ===== NEW METHOD: State subscriptions =====
  setupStateSubscriptions() {
    console.log("[App] Setting up state subscriptions...");

    // Sync auth state between old and new
    this.store.subscribe("auth.isAuthenticated", (isAuth) => {
      console.log("[App] Auth state changed:", isAuth);
      this.isAuthenticated = isAuth; // Keep old variable in sync

      // Update UI
      this.updateAuthStatus(isAuth, this.store.get("auth.domain"));

      // Show/hide login overlay
      if (!isAuth && !this.authCheckInProgress) {
        this.showLoginOverlay(this.store.get("auth.domain"));
      } else if (isAuth) {
        this.hideLoginOverlay();
      }
    });

    // Subscribe to UI errors
    this.store.subscribe("ui.errors", (errors) => {
      if (errors && errors.length > 0) {
        const latestError = errors[errors.length - 1];
        this.showError(latestError.message);
      }
    });

    // Subscribe to context changes
    this.store.subscribe("context.isLoaded", (isLoaded) => {
      console.log("[App] Context loaded state:", isLoaded);
      // Your context manager will handle this
    });

    // Subscribe to active view changes
    this.store.subscribe("ui.activeView", (view) => {
      console.log("[App] View changed to:", view);
      this.showView(view);
      this.setActiveButton(view === "chat" ? "btnChat" : "btnSettings");
    });
  }

  async initialize() {
    console.log("[App] Initializing CompanyGPT Chat...");

    try {
      // Initialize modules (but not chat controller yet)
      this.messageRenderer = new MessageRenderer();

      // Setup UI elements FIRST
      this.setupUIElements();

      // Setup event listeners
      this.setupEventListeners();

      // Initialize ContextManager AFTER UI setup
      this.contextManager = new ContextManager(this);

      // Check authentication (this will show login overlay if needed)
      this.isAuthenticated = await this.checkAuth();

      // Only initialize chat if authenticated
      if (this.isAuthenticated) {
        await this.initializeChat();
      }

      this.isInitialized = true;
      console.log("[App] Initialization complete");
    } catch (error) {
      console.error("[App] Initialization failed:", error);
      this.showError("Initialisierung fehlgeschlagen: " + error.message);
    }
  }

  // === UI SETUP ===
  setupUIElements() {
    this.elements = {
      // Views
      viewChat: document.getElementById("view-chat"),
      viewSettings: document.getElementById("view-settings"),

      // Icon buttons
      btnChat: document.getElementById("btn-chat"),
      btnSettings: document.getElementById("btn-settings"),
      btnClearChat: document.getElementById("btn-clear-chat"),

      // Chat elements
      messagesContainer: document.getElementById("chat-messages"),
      messageInput: document.getElementById("message-input"),
      sendButton: document.getElementById("send-button"),

      // Settings
      currentDomain: document.getElementById("current-domain"),
      useContext: document.getElementById("use-context"),

      // Login overlay elements
      loginOverlay: document.getElementById("login-overlay"),
      btnLogin: document.getElementById("btn-login"),
      btnCheckAuth: document.getElementById("btn-check-auth"),
      loginHint: document.getElementById("login-hint"),
      domainStatus: document.getElementById("domain-status"),
      detectedDomain: document.getElementById("detected-domain"),
      domainInputGroup: document.getElementById("domain-input-group"),
      domainInput: document.getElementById("domain-input"),
    };

    // Debug: log missing elements (only if they're actually missing)
    const missing = Object.entries(this.elements)
      .filter(([_, el]) => !el)
      .map(([key]) => key);

    if (missing.length > 0) {
      console.warn("[App] Missing UI elements:", missing);
    }
  }

  setupEventListeners() {
    // Icon button navigation
    this.elements.btnChat?.addEventListener("click", () => {
      this.showView("chat");
      this.setActiveButton("btnChat");
    });

    this.elements.btnSettings?.addEventListener("click", () => {
      this.showView("settings");
      this.setActiveButton("btnSettings");
    });

    this.elements.btnClearChat?.addEventListener("click", () => {
      this.confirmClearChat();
    });

    // Send message
    this.elements.sendButton?.addEventListener("click", () =>
      this.sendMessage()
    );

    // Enter key to send (but allow Shift+Enter for new line)
    this.elements.messageInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-resize textarea
    this.elements.messageInput?.addEventListener("input", (e) => {
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px";
    });

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message) => {
      this.handleBackgroundMessage(message);
    });

    // Login overlay listeners
    this.elements.btnLogin?.addEventListener("click", () => this.handleLogin());
    this.elements.btnCheckAuth?.addEventListener("click", () =>
      this.recheckAuth()
    );

    // Domain input enter key
    this.elements.domainInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.handleLogin();
      }
    });

    // --- Single debounced tab change handler ---
    let tabChangeTimeout = null;
    let lastProcessedUrl = null;

    const handleTabChangeDebounced = async (tabId, url) => {
      clearTimeout(tabChangeTimeout);

      tabChangeTimeout = setTimeout(async () => {
        if (url === lastProcessedUrl) {
          console.log("[App] Skipping duplicate tab change for:", url);
          return;
        }

        lastProcessedUrl = url;
        console.log("[App] Processing tab change:", url);

        if (this.contextManager) {
          if (!url.startsWith("chrome://") && !url.startsWith("about:")) {
            await this.contextManager.loadPageContext();
          }
        }
      }, 300); // 300ms debounce
    };

    // Listen for tab activation
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab) {
        handleTabChangeDebounced(tab.id, tab.url);
      }
    });

    // Listen for URL changes
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url && tab.active) {
        handleTabChangeDebounced(tabId, changeInfo.url);
      }
    });

    // Listen for visibility changes
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden && this.isInitialized) {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab) {
          handleTabChangeDebounced(tab.id, tab.url);
        }
      }
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest(".context-action-btn")) {
        const button = e.target.closest(".context-action-btn");
        const action = button.dataset.action;
        this.handleContextAction(action);
      }
    });
  }

  // Confirm before clearing chat
  confirmClearChat() {
    if (
      confirm(
        "Chat-Verlauf löschen? Diese Aktion kann nicht rückgängig gemacht werden."
      )
    ) {
      this.clearChatHistory();
    }
  }

  // Clear chat history
  // In app.js
  async clearChatHistory() {
    console.log("[App] Clearing all chat data");

    // Clear store
    this.store.set("chat.messages", []);
    this.store.set("chat.sessionId", null);

    // Clear storage
    await chrome.storage.local.remove(["chatHistory", "chatSessionId"]);

    // Clear UI
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.innerHTML = `
        <div class="message assistant">
          Chat gelöscht. Neuer Start! ✨
        </div>
      `;
    }
  }

  setActiveButton(buttonName) {
    // Remove active class from all buttons
    this.elements.btnChat?.classList.remove("active");
    this.elements.btnSettings?.classList.remove("active");

    // Add active class to selected button
    this.elements[buttonName]?.classList.add("active");
  }

  showView(which) {
    const isChat = which === "chat";

    if (isChat) {
      this.elements.viewChat?.style.removeProperty("display");
      this.elements.viewSettings?.style.setProperty("display", "none");
    } else {
      this.elements.viewChat?.style.setProperty("display", "none");
      this.elements.viewSettings?.style.removeProperty("display");
    }
  }

  // === LOGIN OVERLAY ===
  showLoginOverlay(detectedDomain = null) {
    console.log("[App] Showing login overlay, domain:", detectedDomain);

    // Show overlay
    if (this.elements.loginOverlay) {
      this.elements.loginOverlay.style.display = "flex";
    }

    // Blur background messages
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.classList.add("blurred");
    }

    // Handle domain detection display - with null checks
    if (detectedDomain && this.elements.domainStatus) {
      this.elements.domainStatus.style.display = "block";
      this.elements.detectedDomain &&
        (this.elements.detectedDomain.textContent = detectedDomain + ".506.ai");
      this.elements.domainInputGroup &&
        (this.elements.domainInputGroup.style.display = "none");
    } else {
      this.elements.domainStatus &&
        (this.elements.domainStatus.style.display = "none");
      this.elements.domainInputGroup &&
        (this.elements.domainInputGroup.style.display = "block");
    }

    // Reset buttons with null checks
    this.elements.btnLogin && (this.elements.btnLogin.style.display = "block");
    this.elements.btnCheckAuth &&
      (this.elements.btnCheckAuth.style.display = "none");
    this.elements.loginHint && (this.elements.loginHint.style.display = "none");

    // Disable input
    this.updateAuthStatus(false, detectedDomain);
  }

  hideLoginOverlay() {
    console.log("[App] Hiding login overlay");

    // Hide overlay
    if (this.elements.loginOverlay) {
      this.elements.loginOverlay.style.display = "none";
    }

    // Unblur messages
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.classList.remove("blurred");
    }
  }

  async handleLogin() {
    console.log("[App] Opening login page with new state system");

    // Set loading state
    this.store.set("ui.isLoading", true);

    try {
      let domain =
        this.store.get("auth.domain") ||
        this.store.get("auth.activeDomain") ||
        window.AuthService?.getActiveDomain();

      if (!domain && this.elements.domainInput) {
        const inputValue = this.elements.domainInput.value.trim();
        if (inputValue) {
          if (!/^[a-z0-9-]+$/.test(inputValue)) {
            this.store.actions.showError(
              "Ungültige Subdomain. Bitte nur Kleinbuchstaben, Zahlen und Bindestriche verwenden."
            );
            return;
          }
          domain = inputValue;

          // Save to store and chrome storage
          this.store.set("auth.domain", domain);
          await chrome.storage.local.set({ lastKnownDomain: domain });
        }
      }

      if (!domain) {
        const subdomain = prompt(
          'Bitte gib deine Firmen-Subdomain ein (z.B. "firma" für firma.506.ai):'
        );
        if (!subdomain) {
          this.store.set("ui.isLoading", false);
          return;
        }
        domain = subdomain.trim().toLowerCase();

        // Save to store
        this.store.set("auth.domain", domain);
        await chrome.storage.local.set({ lastKnownDomain: domain });
      }

      const loginUrl = `https://${domain}.506.ai/de/login?callbackUrl=%2F`;
      console.log("[App] Opening login URL:", loginUrl);

      await chrome.tabs.create({ url: loginUrl });

      // Update UI state
      this.elements.btnLogin && (this.elements.btnLogin.style.display = "none");
      this.elements.btnCheckAuth &&
        (this.elements.btnCheckAuth.style.display = "block");
      this.elements.loginHint &&
        (this.elements.loginHint.style.display = "flex");
    } catch (error) {
      console.error("[App] Failed to open login:", error);
      this.store.actions.showError("Fehler beim Öffnen der Anmeldeseite");
    } finally {
      this.store.set("ui.isLoading", false);
    }
  }

  // === AUTH FLOW ===
  async recheckAuth() {
    console.log("[App] Rechecking authentication...]");

    // Prevent multiple simultaneous checks
    if (this.authCheckInProgress) {
      console.log("[App] Auth check already in progress, skipping");
      return;
    }

    this.authCheckInProgress = true;

    // Show loading state
    if (this.elements.btnCheckAuth) {
      this.elements.btnCheckAuth.textContent = "Prüfe...";
      this.elements.btnCheckAuth.disabled = true;
    }

    try {
      // Clear any cached auth state
      if (window.AuthService?.clearCache) {
        window.AuthService.clearCache();
      }

      // Force clear the CONFIG cache to re-detect domain
      if (window.CONFIG) {
        console.log("[App] Reloading config to detect cookies...");
        const script = document.createElement("script");
        script.src = "../shared/config.js?" + Date.now(); // Force reload with cache buster
        document.head.appendChild(script);
      }

      // Wait longer for cookies to be properly set
      console.log("[App] Waiting for cookies to be set...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Try to directly check for the cookie
      const cookieCheck = await this.checkCookieDirectly();
      console.log("[App] Direct cookie check result:", cookieCheck);

      // Force refresh auth check
      const isAuthenticated = await this.checkAuth();
      console.log("[App] Auth check result:", isAuthenticated);

      if (isAuthenticated || cookieCheck) {
        // Success! Hide overlay and initialize
        console.log("[App] Authentication successful!");
        this.hideLoginOverlay();
        this.isAuthenticated = true;

        // Initialize chat
        await this.initializeChat();

        // Update the UI to show success
        if (this.elements.messagesContainer) {
          this.elements.messagesContainer.innerHTML = `
            <div class="message assistant">
              ✅ Erfolgreich angemeldet! Ich kann dir jetzt bei Fragen zur aktuellen Seite helfen.
            </div>
          `;
        }
      } else {
        // Still not authenticated - reset button
        if (this.elements.btnCheckAuth) {
          this.elements.btnCheckAuth.textContent = "Anmeldung prüfen";
          this.elements.btnCheckAuth.disabled = false;
        }

        // Show helpful message
        this.showError(
          "Noch nicht angemeldet. Falls du dich gerade angemeldet hast, warte einen Moment und versuche es erneut."
        );
      }
    } catch (error) {
      console.error("[App] Auth recheck failed:", error);

      // Reset button state
      if (this.elements.btnCheckAuth) {
        this.elements.btnCheckAuth.textContent = "Anmeldung prüfen";
        this.elements.btnCheckAuth.disabled = false;
      }

      this.showError("Fehler beim Prüfen der Anmeldung: " + error.message);
    } finally {
      this.authCheckInProgress = false;
    }
  }

  // New: direct cookie check
  async checkCookieDirectly() {
    try {
      const cookies = await chrome.cookies.getAll({
        domain: ".506.ai",
        name: "__Secure-next-auth.session-token",
      });

      console.log("[App] Found cookies:", cookies.length);

      if (cookies && cookies.length > 0) {
        // Check if any cookie is not expired
        const now = Date.now() / 1000;
        const validCookie = cookies.find((cookie) => {
          return !cookie.expirationDate || cookie.expirationDate > now;
        });

        if (validCookie) {
          console.log("[App] Valid session cookie found!");

          // Extract domain from cookie
          const domain = validCookie.domain
            .replace(/^\./, "")
            .replace(".506.ai", "");

          // IMPORTANT: Update AuthService with the domain info
          if (window.AuthService && window.AuthService._state) {
            window.AuthService._state.cache.activeDomain = domain;
            window.AuthService._state.cache.isAuthenticated = true;
            window.AuthService._state.cache.lastCheck = Date.now();
            console.log("[App] Updated AuthService with domain:", domain);
          }

          // Update auth status
          this.updateAuthStatus(true, domain);

          return true;
        }
      }

      return false;
    } catch (error) {
      console.error("[App] Direct cookie check failed:", error);
      return false;
    }
  }

  // Resilient auth check
  // Resilient auth check
  async checkAuth() {
    console.log("[App] Checking authentication with new state system...");

    try {
      // Update state to show checking
      this.store.set("ui.isLoading", true);

      // Use AuthService but sync with store
      const isAuth = await window.AuthService.checkAuth(true);
      const domain = window.AuthService.getActiveDomain();

      console.log("[App] Auth check result:", isAuth, "Domain:", domain);

      // Update store with auth info - SINGLE SOURCE OF TRUTH
      this.store.batch({
        "auth.isAuthenticated": isAuth,
        "auth.domain": domain,
        "auth.activeDomain": domain,
        "auth.hasMultipleDomains": window.AuthService.hasMultipleDomains(),
        "auth.availableDomains": window.AuthService.getAvailableDomains(),
      });

      return isAuth;
    } catch (error) {
      console.error("[App] Auth check failed:", error);

      // Update store on error
      this.store.batch({
        "auth.isAuthenticated": false,
        "auth.domain": null,
        "ui.showLoginOverlay": true,
      });

      // Add error to state
      this.store.actions.showError("Auth check failed: " + error.message);

      return false;
    } finally {
      this.store.set("ui.isLoading", false);
    }
  }

  updateAuthStatus(isAuthenticated, domain = null) {
    this.isAuthenticated = isAuthenticated;

    if (this.elements.currentDomain && domain) {
      this.elements.currentDomain.textContent = domain + ".506.ai";
    } else if (this.elements.currentDomain) {
      this.elements.currentDomain.textContent = "Nicht verbunden";
    }

    // Enable/disable chat based on auth
    if (this.elements.messageInput) {
      this.elements.messageInput.disabled = !isAuthenticated;
      this.elements.messageInput.placeholder = isAuthenticated
        ? "Nachricht an CompanyGPT"
        : "Bitte melde dich erst bei CompanyGPT an";
    }

    if (this.elements.sendButton) {
      this.elements.sendButton.disabled = !isAuthenticated;
    }
  }

  // === CHAT ===
  async sendMessage(text, context = null) {
    console.log("[ChatController] === SENDING MESSAGE ===");
    console.log("[ChatController] Text:", text);

    if (!this.isInitialized) {
      throw new Error("ChatController not initialized");
    }

    // Build the message
    let finalContent = text;
    if (context && (context.mainContent || context.content)) {
      const contextContent = context.mainContent || context.content;
      finalContent = `[Email-Kontext]\n${contextContent}\n\n[Anfrage]\n${text}`;
      console.log(
        "[ChatController] Added context, length:",
        finalContent.length
      );
    }

    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: "user",
      content: finalContent,
      timestamp: Date.now(),
      references: [],
      sources: [],
    };

    // Get messages, add new one
    const currentMessages = this.store.get("chat.messages") || [];
    currentMessages.push(userMessage);

    // IMMEDIATELY use these messages for the payload
    const sessionId = this.store.get("chat.sessionId") || this.generateChatId();

    const chatPayload = {
      id: sessionId,
      folderId: this.store.get("chat.folderId"),
      messages: currentMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
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

    console.log("[ChatController] SENDING PAYLOAD:");
    console.log("  Messages:", chatPayload.messages.length);
    console.log(
      "  Last msg:",
      chatPayload.messages[chatPayload.messages.length - 1]?.content?.substring(
        0,
        100
      )
    );

    // NOW update the store (after building payload)
    this.store.set("chat.messages", currentMessages);
    this.store.set("chat.sessionId", sessionId);

    try {
      this.store.set("chat.isStreaming", true);

      const domain =
        this.store.get("auth.domain") || this.store.get("auth.activeDomain");
      const chatUrl = `https://${domain}.506.ai/api/qr/chat`;

      console.log(
        "[ChatController] Calling API with",
        chatPayload.messages.length,
        "messages"
      );

      const response = await this.makeAuthenticatedRequest(chatUrl, {
        method: "POST",
        body: JSON.stringify(chatPayload),
      });

      const responseText = await response.text();
      let assistantContent;
      try {
        const jsonResponse = JSON.parse(responseText);
        assistantContent =
          jsonResponse.content || jsonResponse.message || responseText;
      } catch {
        assistantContent = responseText;
      }

      // Add assistant response
      const assistantMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        references: [],
        sources: [],
      };

      // Get fresh messages and add response
      const updatedMessages = this.store.get("chat.messages") || [];
      updatedMessages.push(assistantMessage);
      this.store.set("chat.messages", updatedMessages);

      return assistantMessage;
    } catch (error) {
      console.error("[ChatController] Send failed:", error);
      throw error;
    } finally {
      this.store.set("chat.isStreaming", false);
    }
  }

  async processSendMessage(message) {
    // Clear input and reset height
    this.elements.messageInput.value = "";
    this.elements.messageInput.style.height = "auto";

    // Add user message to UI
    this.addMessage(message, "user");

    // Show enhanced thinking indicator
    const thinkingId = this.showTypingIndicator();

    try {
      // Get context from context manager
      let context = null;
      if (this.contextManager && this.contextManager.hasContext()) {
        context = this.contextManager.getContextForMessage();
      }

      // Send to CompanyGPT API via ChatController
      const response = await this.chatController.sendMessage(message, context);

      // Remove thinking indicator
      this.removeTypingIndicator(thinkingId);

      // Start streaming the response
      const messageId = this.startStreamingMessage();
      await this.streamText(messageId, response.content, 3); // Very fast: 3ms per character
    } catch (error) {
      console.error("[App] Failed to send message:", error);
      this.removeTypingIndicator(thinkingId);
      this.addMessage(`Fehler: ${error.message}`, "error");
    }
  }

  async initializeChat() {
    try {
      console.log("[App] Initializing chat controller...");

      if (!this.chatController) {
        this.chatController = new ChatController();
      }

      // Initialize only if not already initialized
      if (!this.chatController.isInitialized) {
        const success = await this.chatController.initialize();
        if (!success) {
          throw new Error("Chat controller initialization failed");
        }
      }

      console.log("[App] Chat controller ready");

      // Show success message if this is first init
      if (
        this.elements.messagesContainer &&
        !this.elements.messagesContainer.querySelector(".welcome-shown")
      ) {
        this.elements.messagesContainer.innerHTML = `
          <div class="message assistant welcome-shown">
            ✅ Chat bereit! Du kannst jetzt Fragen stellen.
          </div>
        `;
      }
    } catch (error) {
      console.error("[App] Chat initialization failed:", error);
      throw error;
    }
  }

  addMessage(content, role = "assistant") {
    const messageEl = document.createElement("div");
    messageEl.className = `message ${role}`;

    // Handle system messages with icon
    if (role === "system") {
      messageEl.innerHTML = `<span class="system-icon">ℹ️</span> ${content}`;
    } else if (role === "assistant") {
      // Get last user intent
      const lastUserIntent = this.chatController?.getLastUserIntent
        ? this.chatController.getLastUserIntent()
        : null;

      // Added debug logs
      console.log("[App] Last user intent:", lastUserIntent);

      if (lastUserIntent && lastUserIntent !== "general") {
        console.log("[App] Should show buttons for intent:", lastUserIntent);

        // Process markdown first
        const processedContent = this.messageRenderer.renderMarkdown(content);

        // Create container with action buttons
        const containerDiv = document.createElement("div");
        containerDiv.className = "message-with-actions";

        // Add content
        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        contentDiv.innerHTML = processedContent;
        containerDiv.appendChild(contentDiv);

        // Add action buttons
        const buttonsDiv = document.createElement("div");
        buttonsDiv.className = "action-buttons";

        // Copy button (always present)
        const copyBtn = document.createElement("button");
        copyBtn.className = "action-btn copy-btn";
        copyBtn.innerHTML = "📋 Kopieren";
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(content);
          copyBtn.innerHTML = "✅ Kopiert!";
          copyBtn.classList.add("success");
          setTimeout(() => {
            copyBtn.innerHTML = "📋 Kopieren";
            copyBtn.classList.remove("success");
          }, 2000);
        };
        buttonsDiv.appendChild(copyBtn);

        // Add intent-specific buttons
        if (lastUserIntent === "email-reply") {
          const replyBtn = document.createElement("button");
          replyBtn.className = "action-btn gmail-reply-btn";
          replyBtn.innerHTML = "↩️ Als Antwort einfügen";
          replyBtn.onclick = () => this.handleGmailReply(content);
          buttonsDiv.appendChild(replyBtn);
        } else if (lastUserIntent === "email-new") {
          const composeBtn = document.createElement("button");
          composeBtn.className = "action-btn gmail-compose-btn";
          composeBtn.innerHTML = "✉️ Neue E-Mail";
          composeBtn.onclick = () => this.handleGmailCompose(content);
          buttonsDiv.appendChild(composeBtn);
        }

        containerDiv.appendChild(buttonsDiv);
        messageEl.appendChild(containerDiv);
      } else {
        // Just use markdown renderer without actions
        messageEl.innerHTML = this.messageRenderer.renderMarkdown(content);
      }
    } else {
      // User messages and errors as plain text
      messageEl.textContent = content;
    }

    this.elements.messagesContainer?.appendChild(messageEl);
    this.scrollToBottom();
  }

  // Add these handler methods to app.js
  // app.js - Make sure handleGmailReply is correct

  async handleGmailReply(content) {
    console.log("[App] Handling Gmail reply");

    // Parse email content
    const emailData = this.parseEmailContent(content);
    console.log("[App] Parsed email data:", emailData);

    try {
      // Find Gmail tab
      const tabs = await chrome.tabs.query({});
      const gmailTab = tabs.find((tab) => tab.url?.includes("mail.google.com"));

      if (gmailTab) {
        console.log("[App] Found Gmail tab:", gmailTab.id);

        try {
          // Try the original method first (this always worked before)
          const response = await chrome.tabs.sendMessage(gmailTab.id, {
            action: "INSERT_EMAIL_REPLY",
            data: emailData,
          });

          console.log("[App] Insert response:", response);

          // Focus Gmail tab
          await chrome.tabs.update(gmailTab.id, { active: true });
        } catch (messageError) {
          // Content script not responding - inject it
          console.log("[App] Content script not responding, reinjecting...");

          await chrome.scripting.executeScript({
            target: { tabId: gmailTab.id },
            files: ["content/content-script.js"],
          });

          // Wait for script to initialize
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Try again
          const response = await chrome.tabs.sendMessage(gmailTab.id, {
            action: "INSERT_EMAIL_REPLY",
            data: emailData,
          });

          console.log("[App] Insert response (second try):", response);

          // Focus Gmail tab
          await chrome.tabs.update(gmailTab.id, { active: true });
        }
      } else {
        console.log("[App] No Gmail tab found, opening new one");

        // Open Gmail compose with content
        const composeUrl = `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(
          emailData.subject
        )}&body=${encodeURIComponent(emailData.body)}`;
        await chrome.tabs.create({ url: composeUrl });
      }
    } catch (error) {
      console.error("[App] Error inserting Gmail reply:", error);

      // Fallback to clipboard
      navigator.clipboard.writeText(content);
      alert("Email copied to clipboard. Could not insert directly into Gmail.");
    }
  }

  async handleGmailCompose(content) {
    console.log("[App] Handling Gmail compose");

    const emailData = this.parseEmailContent(content);
    const composeUrl = `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(
      emailData.subject
    )}&body=${encodeURIComponent(emailData.body)}`;
    chrome.tabs.create({ url: composeUrl });
  }

  // app.js - Update parseEmailContent to better handle formatting

  parseEmailContent(text) {
    // First, clean up the response from the AI
    let cleanText = text;

    // Remove quotes if wrapped
    if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
      cleanText = cleanText.slice(1, -1);
    }

    // Replace literal \n with actual newlines
    cleanText = cleanText.replace(/\\n/g, "\n");

    // Parse subject and body
    const lines = cleanText.split("\n");
    let subject = "";
    let body = "";
    let foundSubject = false;

    for (const line of lines) {
      if (!foundSubject && line.startsWith("Subject:")) {
        subject = line.replace("Subject:", "").trim();
        foundSubject = true;
      } else if (foundSubject || !line.startsWith("Subject:")) {
        body += line + "\n";
      }
    }

    // Clean up body - remove leading/trailing whitespace
    body = body.trim();

    return {
      subject: subject || "Kein Betreff",
      body: body,
    };
  }

  // Add streaming message support
  startStreamingMessage() {
    const messageId = `message-${Date.now()}`;
    const messageEl = document.createElement("div");
    messageEl.className = "message assistant streaming";
    messageEl.id = messageId;
    messageEl.innerHTML = '<span class="streaming-cursor">▊</span>';

    this.elements.messagesContainer?.appendChild(messageEl);
    this.scrollToBottom();

    return messageId;
  }

  async streamText(messageId, content, speed = 30) {
    const messageEl = document.getElementById(messageId);
    if (!messageEl) return;

    // Preprocess content like we do in addMessage
    let processedContent = content;

    if (processedContent.startsWith('"') && processedContent.endsWith('"')) {
      processedContent = processedContent.slice(1, -1);
    }

    processedContent = processedContent.replace(/\\n\\n\\n\\n/g, "\n\n");
    processedContent = processedContent.replace(/\\n\\n\\n/g, "\n\n");
    processedContent = processedContent.replace(/\\n\\n/g, "\n\n");
    processedContent = processedContent.replace(/\\n/g, "\n");

    // Render final markdown
    const finalHTML = this.messageRenderer
      ? this.messageRenderer.renderMarkdown(processedContent)
      : processedContent.replace(/\n/g, "<br>");

    // Create temporary div to get plain text for streaming
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = finalHTML;
    const plainText = tempDiv.textContent || tempDiv.innerText || "";

    // Stream character by character
    let currentText = "";
    for (let i = 0; i < plainText.length; i++) {
      currentText += plainText[i];

      // Update with current text + cursor
      messageEl.innerHTML = `${currentText.replace(
        /\n/g,
        "<br>"
      )}<span class="streaming-cursor">▊</span>`;
      this.scrollToBottom();

      // Wait before next character
      await new Promise((resolve) => setTimeout(resolve, speed));
    }

    // Replace with final formatted HTML
    messageEl.className = "message assistant";
    messageEl.innerHTML = finalHTML;

    // --- Add action buttons if needed (after streaming completes) ---
    const lastUserIntent = this.chatController?.getLastUserIntent
      ? this.chatController.getLastUserIntent()
      : null;

    console.log("[App] Stream complete, intent:", lastUserIntent);

    if (lastUserIntent && lastUserIntent !== "general") {
      // Avoid duplicating wrapper if already present
      const alreadyWrapped = messageEl.querySelector(".message-with-actions");
      if (!alreadyWrapped) {
        // Prepare buttons
        const buttonsDiv = document.createElement("div");
        buttonsDiv.className = "action-buttons";

        // Copy button
        const copyBtn = document.createElement("button");
        copyBtn.className = "action-btn copy-btn";
        copyBtn.innerHTML = "📋 Kopieren";
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(content);
            copyBtn.innerHTML = "✅ Kopiert!";
            copyBtn.classList.add("success");
          } catch (err) {
            console.error("[App] Clipboard copy failed:", err);
            copyBtn.innerHTML = "⚠️ Fehler";
            copyBtn.classList.add("error");
          } finally {
            setTimeout(() => {
              copyBtn.innerHTML = "📋 Kopieren";
              copyBtn.classList.remove("success", "error");
            }, 2000);
          }
        };
        buttonsDiv.appendChild(copyBtn);

        // Intent-specific buttons
        if (lastUserIntent === "email-reply") {
          const replyBtn = document.createElement("button");
          replyBtn.className = "action-btn gmail-reply-btn";
          replyBtn.innerHTML = "↩️ Als Antwort einfügen";
          replyBtn.onclick = () => this.handleGmailReply(content);
          buttonsDiv.appendChild(replyBtn);
        } else if (lastUserIntent === "email-new") {
          const composeBtn = document.createElement("button");
          composeBtn.className = "action-btn gmail-compose-btn";
          composeBtn.innerHTML = "✉️ Neue E-Mail";
          composeBtn.onclick = () => this.handleGmailCompose(content);
          buttonsDiv.appendChild(composeBtn);
        }

        // Wrap existing content and add buttons
        const currentContent = messageEl.innerHTML; // this is finalHTML
        messageEl.innerHTML = "";

        const containerDiv = document.createElement("div");
        containerDiv.className = "message-with-actions";

        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        contentDiv.innerHTML = currentContent;

        containerDiv.appendChild(contentDiv);
        containerDiv.appendChild(buttonsDiv);

        messageEl.appendChild(containerDiv);
      }
    }

    this.scrollToBottom();
  }

  showTypingIndicator() {
    const typingEl = document.createElement("div");
    typingEl.className = "thinking-indicator";
    typingEl.id = `thinking-${Date.now()}`;
    typingEl.innerHTML = `
      <div class="thinking-content">
        <span class="thinking-text">Denkt nach</span>
        <div class="thinking-dots">
          <div class="thinking-dot"></div>
          <div class="thinking-dot"></div>
          <div class="thinking-dot"></div>
        </div>
      </div>
    `;

    this.elements.messagesContainer?.appendChild(typingEl);
    this.scrollToBottom();

    return typingEl.id;
  }

  removeTypingIndicator(id) {
    document.getElementById(id)?.remove();
  }

  scrollToBottom() {
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.scrollTop =
        this.elements.messagesContainer.scrollHeight;
    }
  }

  startNewChat() {
    if (
      confirm("Neuen Chat starten? Die aktuelle Unterhaltung wird gelöscht.")
    ) {
      // Clear all messages
      this.elements.messagesContainer.innerHTML = `
        <div class="message assistant">
          Neuer Chat gestartet. Ich kann dir bei Fragen zur aktuellen Seite helfen. ✨
        </div>
      `;
      this.chatController?.clearChat();
    }
  }

  // === BROWSER/TABS/MSG ===
  async handleTabChange(tabId) {
    console.log("[App] Tab changed:", tabId);
    // Let ContextManager handle loading/clearing context
    this.contextManager?.loadPageContext();
  }

  handleBackgroundMessage(message) {
    switch (message.type) {
      case "TAB_INFO":
        this.currentTabInfo = message.data;
        this.contextManager?.loadPageContext();
        break;
      case "AUTH_STATE_CHANGED":
        // Re-check auth when auth state changes
        if (!this.authCheckInProgress) {
          this.checkAuth();
        }
        break;
      default:
        console.log("[App] Unknown message type:", message.type);
    }
  }

  showError(message) {
    console.error("[App]", message);

    // Only add to chat if container exists
    if (this.elements.messagesContainer) {
      const errorEl = document.createElement("div");
      errorEl.className = "message error";
      errorEl.textContent = message;
      this.elements.messagesContainer.appendChild(errorEl);
      this.scrollToBottom();
    }
  }

  // Add this method to CompanyGPTChat class
  async handleContextAction(action) {
    console.log("[App] ========== CONTEXT ACTION DEBUG ==========");
    console.log("[App] Action:", action);

    // Check context manager
    console.log("[App] ContextManager exists:", !!this.contextManager);
    console.log("[App] HasContext:", this.contextManager?.hasContext());

    // Get context (single source of truth)
    const context = this.contextManager?.getContextForMessage();
    console.log("[App] Context retrieved:", context);
    console.log(
      "[App] Context has content:",
      !!(context?.content || context?.mainContent)
    );
    console.log(
      "[App] Context content length:",
      (context?.content || context?.mainContent || "").length
    );

    // Check if we have context loaded
    if (!this.contextManager || !this.contextManager.hasContext()) {
      this.showError("Bitte lade zuerst den Seitenkontext");
      return;
    }

    // Check if authenticated
    if (!this.isAuthenticated) {
      this.showError("Bitte melde dich erst an");
      return;
    }

    // Ensure chat controller is initialized
    if (!this.chatController || !this.chatController.isInitialized) {
      console.log("[App] Chat controller not ready, initializing...");
      try {
        await this.initializeChat();
      } catch (error) {
        this.showError("Chat konnte nicht initialisiert werden");
        return;
      }
    }

    // Find the clicked button & add loading state
    const button = document.querySelector(
      `.context-action-btn[data-action="${action}"]`
    );
    if (button) button.classList.add("loading");

    // Flags derived from current context
    const isGmail = !!context?.isGmail || context?.sourceType === "gmail";
    const isGoogleDocs =
      !!context?.isGoogleDocs || context?.sourceType === "docs";
    const isDocumentLike =
      isGoogleDocs || !!context?.isDocument || !!context?.isPage;

    // Build the query based on action
    let query = "";
    switch (action) {
      case "summarize":
        if (isGmail) {
          query =
            "Bitte fasse mir den Email-Verlauf zusammen und bringe mich auf den neuesten Stand.";
        } else if (isGoogleDocs) {
          query =
            "Bitte fasse mir dieses Dokument zusammen und erkläre die wichtigsten Punkte.";
        } else {
          query = "Bitte fasse mir den Inhalt dieser Seite zusammen.";
        }
        break;

      case "reply":
        if (!isGmail) {
          this.showError("Diese Aktion ist nur für E-Mails verfügbar.");
          if (button) button.classList.remove("loading");
          return;
        }
        query =
          "Bitte beantworte mir diese Email professionell und freundlich.";
        break;

      case "reply-with-data":
        if (!isGmail) {
          this.showError("Diese Aktion ist nur für E-Mails verfügbar.");
          if (button) button.classList.remove("loading");
          return;
        }
        query =
          "Bitte beantworte mir diese Email und nutze dabei relevante Informationen aus unserem Datenspeicher.";
        break;

      case "analyze":
        if (!isDocumentLike) {
          this.showError("Diese Aktion ist für Dokumente gedacht.");
          if (button) button.classList.remove("loading");
          return;
        }
        query =
          "Bitte analysiere dieses Dokument und gib mir eine detaillierte Einschätzung.";
        break;

      case "ask-questions":
        if (!isDocumentLike) {
          this.showError("Diese Aktion ist für Dokumente gedacht.");
          if (button) button.classList.remove("loading");
          return;
        }
        query =
          "Bitte erstelle mir wichtige Fragen zu diesem Dokument, die ich beantworten sollte.";
        break;

      default:
        console.error("[App] Unknown action:", action);
        if (button) button.classList.remove("loading");
        return;
    }

    try {
      // Clear input field
      if (this.elements?.messageInput) {
        this.elements.messageInput.value = "";
      }

      // Add user message to chat (for UI)
      this.addMessage(query, "user");

      // Show thinking indicator
      const thinkingId = this.showTypingIndicator();

      // Log what we're about to send
      console.log("[App] Sending to chat controller:");
      console.log("  Query:", query);
      console.log("  Context:", context);

      // Send to CompanyGPT API with the same context instance
      const response = await this.chatController.sendMessage(query, context);

      // Remove thinking indicator
      this.removeTypingIndicator(thinkingId);

      // Stream the response
      const messageId = this.startStreamingMessage();
      await this.streamText(messageId, response?.content || "", 3);
    } catch (error) {
      console.error("[App] Failed to process context action:", error);
      this.showError(`Fehler: ${error.message}`);
    } finally {
      // Remove loading state from button
      if (button) button.classList.remove("loading");
    }
  }
}
// Initialize app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    const app = new CompanyGPTChat();
    app.initialize();
    window.companyGPTChat = app;
  });
} else {
  const app = new CompanyGPTChat();
  app.initialize();
  window.companyGPTChat = app;
}
