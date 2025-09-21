// sidepanel/app.js - CLEANED VERSION
import { ChatController } from "./modules/chat-controller.js";
import { MessageRenderer } from "./modules/message-renderer.js";
import { ContextManager } from "./modules/context-manager.js";
import { DatenspeicherSelector } from "./modules/datenspeicher-selector.js";

class CompanyGPTChat {
  constructor() {
    // Use AppStore as single source of truth
    this.store = window.AppStore;

    // Core modules
    this.chatController = null;
    this.messageRenderer = null;
    this.contextManager = null;

    // Cache UI element refs
    this.elements = {};

    // Setup state subscriptions
    this.setupStateSubscriptions();
  }

  setupStateSubscriptions() {
    console.log("[App] Setting up state subscriptions...");

    // Auth state changes
    this.store.subscribe("auth.isAuthenticated", (isAuth) => {
      console.log("[App] Auth state changed:", isAuth);

      // Update UI
      this.updateAuthStatus(isAuth, this.store.get("auth.domain"));

      // Show/hide login overlay
      if (!isAuth) {
        this.showLoginOverlay(this.store.get("auth.domain"));
      } else {
        this.hideLoginOverlay();
      }
    });

    // UI errors
    this.store.subscribe("ui.errors", (errors) => {
      if (errors && errors.length > 0) {
        const latestError = errors[errors.length - 1];
        this.showError(latestError.message);
      }
    });

    // Context changes
    this.store.subscribe("context.isLoaded", (isLoaded) => {
      console.log("[App] Context loaded state:", isLoaded);
    });

    // Active view changes
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

      // NEW: Initialize DatenspeicherSelector after ContextManager
      try {
        this.datenspeicherSelector = new DatenspeicherSelector(this.store);
        console.log("[App] DatenspeicherSelector initialized");
      } catch (dsErr) {
        console.warn(
          "[App] DatenspeicherSelector could not be initialized:",
          dsErr
        );
      }

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

    // Debug: log missing elements
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

    // Tab change handler with debouncing
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
      }, 300);
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
      if (!document.hidden && this.store.get("ui.initialized")) {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab) {
          handleTabChangeDebounced(tab.id, tab.url);
        }
      }
    });

    // Context action buttons — UPDATED
    // In your setupEventListeners method in app.js, replace the context action buttons listener with this:

    // Context action buttons - UPDATED for split button
    // Context action buttons - Updated for proper split button
    document.addEventListener("click", (e) => {
      const button = e.target.closest(
        '.context-action-btn[data-action="reply-with-data"]'
      );

      if (button) {
        e.preventDefault();
        e.stopPropagation();

        const hasSelection = button.classList.contains("has-selection");
        const clickedElement = e.target;

        // Determine which part was clicked
        const isDropdownClick = clickedElement.closest(".button-dropdown");
        const isMainClick = clickedElement.closest(".button-main");

        if (!hasSelection) {
          // No selection - any click opens dropdown
          if (this.datenspeicherSelector) {
            this.datenspeicherSelector.open();
          }
        } else {
          // Has selection - split functionality
          if (isDropdownClick) {
            // Clicked dropdown arrow - open selector
            if (this.datenspeicherSelector) {
              this.datenspeicherSelector.open();
            }
          } else if (isMainClick) {
            // Clicked main area - execute action with selected Datenspeicher
            const selectedFolder =
              this.datenspeicherSelector?.getSelectedFolder();
            if (selectedFolder) {
              this.handleDatenspeicherReply({
                folderId: selectedFolder.id,
                folderName: selectedFolder.name,
              });
            }
          }
        }
        return;
      }

      // Handle other context action buttons
      const otherButton = e.target.closest(".context-action-btn");
      if (otherButton && otherButton.dataset.action !== "reply-with-data") {
        const action = otherButton.dataset.action;
        this.handleContextAction(action);
      }
    });

    // Listen for Datenspeicher selection
    window.addEventListener("datenspeicher-selected", (e) => {
      this.handleDatenspeicherReply(e.detail);
    });
  }

  confirmClearChat() {
    if (
      confirm(
        "Chat-Verlauf löschen? Diese Aktion kann nicht rückgängig gemacht werden."
      )
    ) {
      this.clearChatHistory();
    }
  }

  async clearChatHistory() {
    console.log("[App] Clearing all chat data");

    // Use store action
    this.store.actions.clearChat();

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

    // Handle domain detection display
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

    // Reset buttons
    this.elements.btnLogin && (this.elements.btnLogin.style.display = "block");
    this.elements.btnCheckAuth &&
      (this.elements.btnCheckAuth.style.display = "none");
    this.elements.loginHint && (this.elements.loginHint.style.display = "none");

    // Disable input
    this.updateAuthStatus(false, detectedDomain);
  }

  hideLoginOverlay() {
    console.log("[App] Hiding login overlay");

    if (this.elements.loginOverlay) {
      this.elements.loginOverlay.style.display = "none";
    }

    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.classList.remove("blurred");
    }
  }

  async handleLogin() {
    console.log("[App] Opening login page");

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

  async recheckAuth() {
    console.log("[App] Rechecking authentication...");

    const isCheckInProgress = this.store.get("auth.checkInProgress");
    if (isCheckInProgress) {
      console.log("[App] Auth check already in progress, skipping");
      return;
    }

    this.store.set("auth.checkInProgress", true);

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

      // Wait for cookies to be properly set
      console.log("[App] Waiting for cookies to be set...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Try to directly check for the cookie
      const cookieCheck = await this.checkCookieDirectly();
      console.log("[App] Direct cookie check result:", cookieCheck);

      // Force refresh auth check
      const isAuthenticated = await this.checkAuth();
      console.log("[App] Auth check result:", isAuthenticated);

      if (isAuthenticated || cookieCheck) {
        console.log("[App] Authentication successful!");
        this.hideLoginOverlay();
        this.store.set("auth.isAuthenticated", true);

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
        // Reset button
        if (this.elements.btnCheckAuth) {
          this.elements.btnCheckAuth.textContent = "Anmeldung prüfen";
          this.elements.btnCheckAuth.disabled = false;
        }

        this.showError(
          "Noch nicht angemeldet. Falls du dich gerade angemeldet hast, warte einen Moment und versuche es erneut."
        );
      }
    } catch (error) {
      console.error("[App] Auth recheck failed:", error);

      if (this.elements.btnCheckAuth) {
        this.elements.btnCheckAuth.textContent = "Anmeldung prüfen";
        this.elements.btnCheckAuth.disabled = false;
      }

      this.showError("Fehler beim Prüfen der Anmeldung: " + error.message);
    } finally {
      this.store.set("auth.checkInProgress", false);
    }
  }

  async checkCookieDirectly() {
    try {
      const cookies = await chrome.cookies.getAll({
        domain: ".506.ai",
        name: "__Secure-next-auth.session-token",
      });

      console.log("[App] Found cookies:", cookies.length);

      if (cookies && cookies.length > 0) {
        const now = Date.now() / 1000;
        const validCookie = cookies.find((cookie) => {
          return !cookie.expirationDate || cookie.expirationDate > now;
        });

        if (validCookie) {
          console.log("[App] Valid session cookie found!");

          const domain = validCookie.domain
            .replace(/^\./, "")
            .replace(".506.ai", "");

          // Update AuthService with the domain info
          if (window.AuthService && window.AuthService._state) {
            window.AuthService._state.cache.activeDomain = domain;
            window.AuthService._state.cache.isAuthenticated = true;
            window.AuthService._state.cache.lastCheck = Date.now();
            console.log("[App] Updated AuthService with domain:", domain);
          }

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

  async checkAuth() {
    console.log("[App] Checking authentication...");

    try {
      this.store.set("ui.isLoading", true);

      const isAuth = await window.AuthService.checkAuth(true);
      const domain = window.AuthService.getActiveDomain();

      console.log("[App] Auth check result:", isAuth, "Domain:", domain);

      // Update store with auth info
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

      this.store.batch({
        "auth.isAuthenticated": false,
        "auth.domain": null,
        "ui.showLoginOverlay": true,
      });

      this.store.actions.showError("Auth check failed: " + error.message);
      return false;
    } finally {
      this.store.set("ui.isLoading", false);
    }
  }

  updateAuthStatus(isAuthenticated, domain = null) {
    if (this.elements.currentDomain && domain) {
      this.elements.currentDomain.textContent = domain + ".506.ai";
    } else if (this.elements.currentDomain) {
      this.elements.currentDomain.textContent = "Nicht verbunden";
    }

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

  async sendMessage() {
    const message = this.elements.messageInput?.value?.trim();

    if (!message) return;

    // Clear input immediately
    this.elements.messageInput.value = "";
    this.elements.messageInput.style.height = "auto";

    console.log("[App] User sending message:", message);

    await this.processSendMessage(message);
  }

  async processSendMessage(message) {
    console.log("[App] Processing message:", message);

    // Add user message to UI immediately
    this.addMessage(message, "user");

    // Show thinking indicator
    const thinkingId = this.showTypingIndicator();

    try {
      // Get context if available
      let context = null;
      if (this.contextManager && this.contextManager.hasContext()) {
        context = this.contextManager.getContextForMessage();
        console.log("[App] Including context with message");
      }

      // Send to CompanyGPT API via ChatController
      console.log("[App] Sending to chat controller...");
      const response = await this.chatController.sendMessage(message, context);

      console.log("[App] Received response from chat controller");

      // Remove thinking indicator
      this.removeTypingIndicator(thinkingId);

      // Stream the response
      const messageId = this.startStreamingMessage();
      await this.streamText(messageId, response.content, 3);
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

      if (!this.chatController.isInitialized) {
        const success = await this.chatController.initialize();
        if (!success) {
          throw new Error("Chat controller initialization failed");
        }
      }

      console.log("[App] Chat controller ready");

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

    if (role === "system") {
      messageEl.innerHTML = `<span class="system-icon">ℹ️</span> ${content}`;
    } else if (role === "assistant") {
      const lastUserIntent = this.chatController?.getLastUserIntent
        ? this.chatController.getLastUserIntent()
        : null;

      console.log("[App] Last user intent:", lastUserIntent);

      if (lastUserIntent && lastUserIntent !== "general") {
        console.log("[App] Should show buttons for intent:", lastUserIntent);

        const processedContent = this.messageRenderer.renderMarkdown(content);

        const containerDiv = document.createElement("div");
        containerDiv.className = "message-with-actions";

        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        contentDiv.innerHTML = processedContent;
        containerDiv.appendChild(contentDiv);

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
        messageEl.innerHTML = this.messageRenderer.renderMarkdown(content);
      }
    } else {
      // User messages and errors as plain text
      messageEl.textContent = content;
    }

    this.elements.messagesContainer?.appendChild(messageEl);
    this.scrollToBottom();
  }

  async handleGmailReply(content) {
    console.log("[App] Handling Gmail reply");

    const emailData = this.parseEmailContent(content);
    console.log("[App] Parsed email data:", emailData);

    try {
      const tabs = await chrome.tabs.query({});
      const gmailTab = tabs.find((tab) => tab.url?.includes("mail.google.com"));

      if (gmailTab) {
        console.log("[App] Found Gmail tab:", gmailTab.id);

        try {
          const response = await chrome.tabs.sendMessage(gmailTab.id, {
            action: "INSERT_EMAIL_REPLY",
            data: emailData,
          });

          console.log("[App] Insert response:", response);
          await chrome.tabs.update(gmailTab.id, { active: true });
        } catch (messageError) {
          console.log("[App] Content script not responding, reinjecting...");

          await chrome.scripting.executeScript({
            target: { tabId: gmailTab.id },
            files: ["content/content-script.js"],
          });

          await new Promise((resolve) => setTimeout(resolve, 500));

          const response = await chrome.tabs.sendMessage(gmailTab.id, {
            action: "INSERT_EMAIL_REPLY",
            data: emailData,
          });

          console.log("[App] Insert response (second try):", response);
          await chrome.tabs.update(gmailTab.id, { active: true });
        }
      } else {
        console.log("[App] No Gmail tab found, opening new one");

        const composeUrl = `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(
          emailData.subject
        )}&body=${encodeURIComponent(emailData.body)}`;
        await chrome.tabs.create({ url: composeUrl });
      }
    } catch (error) {
      console.error("[App] Error inserting Gmail reply:", error);
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

  parseEmailContent(text) {
    let cleanText = text;

    if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
      cleanText = cleanText.slice(1, -1);
    }

    cleanText = cleanText.replace(/\\n/g, "\n");

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

    body = body.trim();

    return {
      subject: subject || "Kein Betreff",
      body: body,
    };
  }

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

    let processedContent = content;

    if (processedContent.startsWith('"') && processedContent.endsWith('"')) {
      processedContent = processedContent.slice(1, -1);
    }

    processedContent = processedContent.replace(/\\n\\n\\n\\n/g, "\n\n");
    processedContent = processedContent.replace(/\\n\\n\\n/g, "\n\n");
    processedContent = processedContent.replace(/\\n\\n/g, "\n\n");
    processedContent = processedContent.replace(/\\n/g, "\n");

    const finalHTML = this.messageRenderer
      ? this.messageRenderer.renderMarkdown(processedContent)
      : processedContent.replace(/\n/g, "<br>");

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = finalHTML;
    const plainText = tempDiv.textContent || tempDiv.innerText || "";

    let currentText = "";
    for (let i = 0; i < plainText.length; i++) {
      currentText += plainText[i];

      messageEl.innerHTML = `${currentText.replace(
        /\n/g,
        "<br>"
      )}<span class="streaming-cursor">▊</span>`;
      this.scrollToBottom();

      await new Promise((resolve) => setTimeout(resolve, speed));
    }

    messageEl.className = "message assistant";
    messageEl.innerHTML = finalHTML;

    const lastUserIntent = this.chatController?.getLastUserIntent
      ? this.chatController.getLastUserIntent()
      : null;

    console.log("[App] Stream complete, intent:", lastUserIntent);

    if (lastUserIntent && lastUserIntent !== "general") {
      const alreadyWrapped = messageEl.querySelector(".message-with-actions");
      if (!alreadyWrapped) {
        const buttonsDiv = document.createElement("div");
        buttonsDiv.className = "action-buttons";

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

        const currentContent = messageEl.innerHTML;
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

  async handleTabChange(tabId) {
    console.log("[App] Tab changed:", tabId);
    this.contextManager?.loadPageContext();
  }

  handleBackgroundMessage(message) {
    switch (message.type) {
      case "TAB_INFO":
        this.store.set("tab.info", message.data);
        this.contextManager?.loadPageContext();
        break;
      case "AUTH_STATE_CHANGED":
        // Re-check auth when auth state changes
        this.checkAuth();
        break;
      default:
        console.log("[App] Unknown message type:", message.type);
    }
  }

  showError(message) {
    console.error("[App]", message);

    if (this.elements.messagesContainer) {
      const errorEl = document.createElement("div");
      errorEl.className = "message error";
      errorEl.textContent = message;
      this.elements.messagesContainer.appendChild(errorEl);
      this.scrollToBottom();
    }
  }

  async handleContextAction(action) {
    console.log("[App] Context action:", action);

    // Get context
    const context = this.contextManager?.getContextForMessage();
    console.log("[App] Context retrieved:", context);

    if (!this.contextManager || !this.contextManager.hasContext()) {
      this.showError("Bitte lade zuerst den Seitenkontext");
      return;
    }

    if (!this.store.get("auth.isAuthenticated")) {
      this.showError("Bitte melde dich erst an");
      return;
    }

    if (!this.chatController || !this.chatController.isInitialized) {
      console.log("[App] Chat controller not ready, initializing...");
      try {
        await this.initializeChat();
      } catch (error) {
        this.showError("Chat konnte nicht initialisiert werden");
        return;
      }
    }

    const button = document.querySelector(
      `.context-action-btn[data-action="${action}"]`
    );
    if (button) button.classList.add("loading");

    const isGmail = !!context?.isGmail || context?.sourceType === "gmail";
    const isGoogleDocs =
      !!context?.isGoogleDocs || context?.sourceType === "docs";
    const isDocumentLike =
      isGoogleDocs || !!context?.isDocument || !!context?.isPage;

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
      if (this.elements?.messageInput) {
        this.elements.messageInput.value = "";
      }

      this.addMessage(query, "user");

      const thinkingId = this.showTypingIndicator();

      console.log("[App] Sending to chat controller:");
      console.log("  Query:", query);
      console.log("  Context:", context);

      const response = await this.chatController.sendMessage(query, context);

      this.removeTypingIndicator(thinkingId);

      const messageId = this.startStreamingMessage();
      await this.streamText(messageId, response?.content || "", 3);
    } catch (error) {
      console.error("[App] Failed to process context action:", error);
      this.showError(`Fehler: ${error.message}`);
    } finally {
      if (button) button.classList.remove("loading");
    }
  }
  // Add this method to your CompanyGPTChat class in app.js
  // Place it after the handleContextAction method

  async handleDatenspeicherReply(selection) {
    console.log(
      "[App] Datenspeicher selected for multi-step reply:",
      selection
    );

    // Check if we have context
    const context = this.contextManager?.getContextForMessage();
    if (!context) {
      this.showError("Bitte lade zuerst den Seitenkontext");
      return;
    }

    // Check if it's Gmail
    const isGmail = !!context?.isGmail || context?.sourceType === "gmail";
    if (!isGmail) {
      this.showError("Diese Aktion ist nur für E-Mails verfügbar.");
      return;
    }

    // Check if authenticated
    if (!this.store.get("auth.isAuthenticated")) {
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

    // Build initial query message
    const query = `Bitte beantworte mir diese Email und nutze dabei relevante Informationen aus dem Datenspeicher "${selection.folderName}".`;

    try {
      // Clear input field
      if (this.elements?.messageInput) {
        this.elements.messageInput.value = "";
      }

      // Add user message to chat
      this.addMessage(query, "user");

      console.log("[App] Starting multi-step Datenspeicher process");

      // Use the new multi-step method
      const response = await this.chatController.sendDatanspeicherReply(
        query,
        context,
        selection.folderId,
        selection.folderName
      );

      // Only show response if not aborted
      if (response) {
        // Add the final assistant message
        const messageId = this.startStreamingMessage();
        await this.streamText(messageId, response.content, 3);
      }

      console.log("[App] Multi-step Datenspeicher reply completed");
    } catch (error) {
      console.error("[App] Failed to process Datenspeicher reply:", error);
      this.showError(`Fehler: ${error.message}`);
    }
  }

  // Add method to toggle RAG results
  toggleRAGResults() {
    const isExpanded = this.store.get("chat.ragResultsExpanded");
    this.store.set("chat.ragResultsExpanded", !isExpanded);

    // Update UI
    const ragResults = document.querySelector(".rag-results");
    const ragContent = document.querySelector(".rag-results-content");
    const ragArrow = document.querySelector(".rag-arrow");

    if (ragResults && ragContent && ragArrow) {
      if (!isExpanded) {
        ragResults.classList.add("expanded");
        ragContent.style.display = "block";
        ragArrow.textContent = "▼";
      } else {
        ragResults.classList.remove("expanded");
        ragContent.style.display = "none";
        ragArrow.textContent = "▶";
      }
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
