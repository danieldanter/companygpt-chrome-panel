// sidepanel/app.js
import { ChatController } from "./modules/chat-controller.js";
import { MessageRenderer } from "./modules/message-renderer.js";
import { ContextAnalyzer } from "./modules/context-analyzer.js";

/* ---------------------------------------------------------
   Simplified ContextManager (replacing previous version)
--------------------------------------------------------- */

class ContextManager {
  constructor(app) {
    this.app = app;
    this.currentContext = null;
    this.isLoaded = false;
    this.lastUrl = null;

    // UI elements
    this.loadButton = null;
    this.contextBar = null;
    this.contextText = null;
    this.clearButton = null;

    this.init();
  }

  init() {
    console.log("[ContextManager] Initializing...");

    // Get UI elements
    this.loadButton = document.getElementById("load-context-btn");
    this.contextBar = document.getElementById("context-bar");
    this.contextText = document.getElementById("context-text");
    this.clearButton = document.getElementById("clear-context");

    // Setup event listeners
    this.setupEventListeners();

    // Monitor page changes
    this.monitorPageChanges();
  }

  setupEventListeners() {
    // Load context button
    this.loadButton?.addEventListener("click", () => {
      this.loadPageContext();
    });

    // Clear context button
    this.clearButton?.addEventListener("click", () => {
      this.clearContext();
    });
  }

  async monitorPageChanges() {
    // Check for URL changes every 2 seconds
    setInterval(async () => {
      const currentUrl = await this.getCurrentUrl();

      if (this.lastUrl && currentUrl !== this.lastUrl) {
        console.log("[ContextManager] Page changed:", currentUrl);
        this.onPageChange(currentUrl);
      }

      this.lastUrl = currentUrl;
    }, 2000);
  }

  async getCurrentUrl() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab?.url || "";
    } catch {
      return "";
    }
  }

  onPageChange(newUrl) {
    // Reset context when page changes
    this.clearContext();

    // Show subtle notification that context is available
    this.showContextAvailable();
  }

  showContextAvailable() {
    // Add a subtle pulse to the load button
    this.loadButton?.classList.add("context-available");
    setTimeout(() => {
      this.loadButton?.classList.remove("context-available");
    }, 3000);
  }

  async loadPageContext() {
    if (!this.loadButton) return;

    console.log("[ContextManager] Loading page context...");

    // Set loading state
    this.setButtonState("loading");

    try {
      // Get page context using the app's method
      const context = await this.app.getPageContext();

      if (
        !context ||
        (Object.prototype.hasOwnProperty.call(context, "success") &&
          !context.success)
      ) {
        throw new Error(context?.error || "No context available");
      }

      // Process the context
      const processedContext = this.processContext(context);

      // Store context
      this.currentContext = processedContext;
      this.isLoaded = true;

      // Update UI
      this.setButtonState("loaded");
      this.showContextBar(processedContext);

      console.log(
        "[ContextManager] Context loaded successfully:",
        processedContext
      );
    } catch (error) {
      console.error("[ContextManager] Failed to load context:", error);
      this.setButtonState("error");

      // Reset after 3 seconds
      setTimeout(() => {
        this.setButtonState("default");
      }, 3000);
    }
  }

  processContext(rawContext) {
    console.log("[ContextManager] Processing context:", rawContext);

    // Clean and process the text content
    let textContent = "";
    if (rawContext.mainContent) {
      textContent = this.cleanText(rawContext.mainContent);
    }

    // Get selected text if available
    let selectedText = "";
    if (rawContext.selectedText) {
      selectedText = this.cleanText(rawContext.selectedText);
    }

    // Calculate word count
    const wordCount = textContent
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    const processedContext = {
      title: rawContext.title || "Untitled Page",
      url: rawContext.url || "",
      selectedText,
      mainContent: textContent,
      wordCount,
      timestamp: Date.now(),
      isGoogleDocs: rawContext.metadata?.isGoogleDocs || false,
    };

    console.log("[ContextManager] Context processed:", {
      title: processedContext.title,
      wordCount: processedContext.wordCount,
      hasSelectedText: !!processedContext.selectedText,
      isGoogleDocs: processedContext.isGoogleDocs,
      contentLength: processedContext.mainContent.length,
    });

    return processedContext;
  }

  cleanText(text) {
    if (!text) return "";

    // Remove extra whitespace and clean up
    return text
      .replace(/\s+/g, " ") // Multiple spaces to single space
      .replace(/\n\s*\n/g, "\n") // Multiple newlines to single
      .trim();
  }

  setButtonState(state) {
    if (!this.loadButton) return;

    // Remove all state classes
    this.loadButton.classList.remove("loading", "loaded", "error");
    this.loadButton.setAttribute("data-state", state);

    // Update button appearance based on state
    switch (state) {
      case "loading":
        this.loadButton.classList.add("loading");
        this.loadButton.disabled = true;
        this.loadButton.title = "Loading context...";
        break;

      case "loaded":
        this.loadButton.classList.add("loaded");
        this.loadButton.disabled = false;
        this.loadButton.title = "Context loaded - click to refresh";
        break;

      case "error":
        this.loadButton.disabled = false;
        this.loadButton.title = "Failed to load context - click to retry";
        break;

      default: // 'default'
        this.loadButton.disabled = false;
        this.loadButton.title = "Load page context";
    }
  }

  showContextBar(context) {
    if (!this.contextBar || !this.contextText) return;

    // Create context info text
    let contextInfo = `${context.title}`;

    if (context.wordCount > 0) {
      contextInfo += ` (${context.wordCount} words)`;
    }

    if (context.isGoogleDocs) {
      contextInfo += ` • Google Docs`;
    }

    // Update context text
    this.contextText.textContent = contextInfo;

    // Show context bar
    this.contextBar.style.display = "flex";

    // Show clear button
    if (this.clearButton) {
      this.clearButton.style.display = "flex";
    }
  }

  clearContext() {
    console.log("[ContextManager] Clearing context");

    // Clear stored context
    this.currentContext = null;
    this.isLoaded = false;

    // Reset button state
    this.setButtonState("default");

    // Hide context bar
    if (this.contextBar) {
      this.contextBar.style.display = "none";
    }

    // Hide clear button
    if (this.clearButton) {
      this.clearButton.style.display = "none";
    }
  }

  // Method to get context for including in messages
  getContextForMessage() {
    if (!this.isLoaded || !this.currentContext) {
      return null;
    }

    return this.currentContext;
  }

  // Check if context is loaded
  hasContext() {
    return this.isLoaded && this.currentContext !== null;
  }
}

/* ---------------------------------------------------------
   Subtle pulse CSS for context button
--------------------------------------------------------- */

const contextAvailableCSS = `
.context-load-btn.context-available {
  animation: contextPulse 2s ease-in-out;
}

@keyframes contextPulse {
  0%, 100% { 
    background: transparent; 
    color: var(--text-muted);
  }
  50% { 
    background: rgba(14, 165, 233, 0.1); 
    color: var(--blue-600);
  }
}
`;

// Inject the CSS
const style = document.createElement("style");
style.textContent = contextAvailableCSS;
document.head.appendChild(style);

/* ---------------------------------------------------------
   CompanyGPTChat (wired to simplified ContextManager)
--------------------------------------------------------- */

class CompanyGPTChat {
  constructor() {
    this.chatController = null;
    this.messageRenderer = null;
    this.contextAnalyzer = null;
    this.currentTabInfo = null;
    this.isInitialized = false;
    this.isAuthenticated = false; // Track auth state
    this.authCheckInProgress = false; // Prevent multiple auth checks

    // Session/context management (kept minimal)
    this.lastKnownUrl = null;
    this.lastKnownDomain = null;
    this.sessionStartTime = null;

    // ContextManager instance
    this.contextManager = null;

    // Cache UI refs
    this.elements = {};
  }

  async initialize() {
    console.log("[App] Initializing CompanyGPT Chat...");

    try {
      // Initialize modules (but not chat controller yet)
      this.messageRenderer = new MessageRenderer();
      this.contextAnalyzer = new ContextAnalyzer();

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

    // Listen for tab activation (user switches tabs)
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      // Small delay to let the tab fully load
      setTimeout(() => {
        this.handleTabChange(activeInfo.tabId);
      }, 100);
    });

    // Also listen for URL changes in the same tab
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url && tab.active) {
        console.log("[App] URL changed in active tab:", changeInfo.url);
        setTimeout(() => {
          this.handleTabChange(tabId);
        }, 100);
      }
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

    // Better tab change detection
    let lastActiveTabUrl = null;

    // Check for tab changes every time user focuses the side panel
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden && this.isInitialized) {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab && tab.url !== lastActiveTabUrl) {
          lastActiveTabUrl = tab.url;
          await this.handleTabChange(tab.id);
        }
      }
    });

    // Also listen for tab activation (debounced)
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      if (this.isInitialized) {
        setTimeout(async () => {
          const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (tab && tab.url !== lastActiveTabUrl) {
            lastActiveTabUrl = tab.url;
            await this.handleTabChange(activeInfo.tabId);
          }
        }, 100);
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
  async clearChatHistory() {
    try {
      // Clear storage
      await chrome.storage.local.remove(["chatHistory", "chatSessionId"]);

      // Clear the UI
      if (this.elements.messagesContainer) {
        this.elements.messagesContainer.innerHTML = `
          <div class="message assistant">
            Chat-Verlauf wurde gelöscht. Neuer Chat gestartet! ✨
          </div>
        `;
      }

      // Reset chat controller
      if (this.chatController) {
        this.chatController.messages = [];
        this.chatController.sessionId = null;
      }

      console.log("[App] Chat history cleared");
    } catch (error) {
      console.error("[App] Failed to clear chat history:", error);
      this.showError("Fehler beim Löschen des Chat-Verlaufs");
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
    console.log("[App] Opening login page]");

    try {
      let loginUrl = "";
      let domain = "";

      // Try to get domain from CONFIG
      if (window.CONFIG?.DOMAIN) {
        domain = window.CONFIG.DOMAIN;
      }

      // If no domain from CONFIG, check AuthService
      if (!domain && window.AuthService?.getActiveDomain) {
        domain = window.AuthService.getActiveDomain();
      }

      // If still no domain, check the input field
      if (!domain && this.elements.domainInput) {
        const inputValue = this.elements.domainInput.value.trim();
        if (inputValue) {
          // Validate subdomain format
          if (!/^[a-z0-9-]+$/.test(inputValue)) {
            alert(
              "Ungültige Subdomain. Bitte nur Kleinbuchstaben, Zahlen und Bindestriche verwenden."
            );
            return;
          }
          domain = inputValue;

          // Save for future use
          await chrome.storage.local.set({ lastKnownDomain: domain });
        }
      }

      // If still no domain, prompt user
      if (!domain) {
        const subdomain = prompt(
          'Bitte gib deine Firmen-Subdomain ein (z.B. "firma" für firma.506.ai):'
        );
        if (!subdomain) {
          return;
        }
        domain = subdomain.trim().toLowerCase();

        // Save for future use
        await chrome.storage.local.set({ lastKnownDomain: domain });
      }

      // Build login URL
      loginUrl = `https://${domain}.506.ai/de/login?callbackUrl=%2F`;

      console.log("[App] Opening login URL:", loginUrl);

      // Open login in new tab
      await chrome.tabs.create({ url: loginUrl });

      // Update UI to show waiting state
      this.elements.btnLogin && (this.elements.btnLogin.style.display = "none");
      this.elements.btnCheckAuth &&
        (this.elements.btnCheckAuth.style.display = "block");
      this.elements.loginHint &&
        (this.elements.loginHint.style.display = "flex");

      // Update domain display if it wasn't shown before
      if (domain && this.elements.domainStatus) {
        this.elements.domainStatus.style.display = "block";
        this.elements.detectedDomain &&
          (this.elements.detectedDomain.textContent = domain + ".506.ai");
        this.elements.domainInputGroup &&
          (this.elements.domainInputGroup.style.display = "none");
      }

      // Wait for user to click "Anmeldung prüfen"
    } catch (error) {
      console.error("[App] Failed to open login:", error);
      this.showError("Fehler beim Öffnen der Anmeldeseite");
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
    console.log("[App] Checking authentication...]");

    try {
      // Just use AuthService - it should handle everything
      const isAuth = await window.AuthService.checkAuth(true); // Force refresh
      const domain = window.AuthService.getActiveDomain();

      console.log("[App] AuthService check result:", isAuth, "Domain:", domain);

      this.updateAuthStatus(isAuth, domain);

      // Only show/hide overlay if not already checking
      if (!this.authCheckInProgress) {
        if (!isAuth) {
          this.showLoginOverlay(domain);
        } else {
          this.hideLoginOverlay();
        }
      }

      console.log("[App] Auth result:", isAuth, "Domain:", domain);
      console.log(
        "[App] AuthService domain:",
        window.AuthService?.getActiveDomain()
      );
      return isAuth;
    } catch (error) {
      console.error("[App] Auth check failed:", error);
      this.updateAuthStatus(false);

      // Only show overlay if this is not a recheck
      if (!this.authCheckInProgress) {
        this.showLoginOverlay(null);
      }

      return false;
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
  async sendMessage() {
    const message = this.elements.messageInput?.value?.trim();
    if (!message) return;

    console.log("[App] Sending message:", message);

    // Check if authenticated
    if (!this.isAuthenticated) {
      this.showError("Bitte melde dich erst an");
      return;
    }

    // Check if chat controller is initialized
    if (!this.chatController || !this.chatController.isInitialized) {
      console.log("[App] ChatController not ready, initializing...");
      try {
        await this.initializeChat();
      } catch (error) {
        this.showError("Chat konnte nicht initialisiert werden");
        return;
      }
    }

    // No automatic context switching — rely on ContextManager if user loaded one
    await this.processSendMessage(message);
  }

  async processSendMessage(message) {
    // Clear input and reset height
    this.elements.messageInput.value = "";
    this.elements.messageInput.style.height = "auto";

    // Add user message to UI
    this.addMessage(message, "user");

    // Show typing indicator
    const typingId = this.showTypingIndicator();

    try {
      console.log("[App] Processing message with context manager...");

      // NEW: Get context from context manager ONLY
      let context = null;
      if (this.contextManager && this.contextManager.hasContext()) {
        context = this.contextManager.getContextForMessage();
        console.log("[App] Using loaded context from ContextManager:", context);
      } else {
        console.log("[App] No context loaded in ContextManager");
      }

      console.log("[App] Calling ChatController.sendMessage...");

      // Send to CompanyGPT API via ChatController
      const response = await this.chatController.sendMessage(message, context);

      console.log("[App] Got response:", response);

      // Remove typing indicator
      this.removeTypingIndicator(typingId);

      // Add assistant response
      this.addMessage(response.content, "assistant");
    } catch (error) {
      console.error("[App] Failed to send message:", error);
      this.removeTypingIndicator(typingId);
      this.addMessage(`Fehler: ${error.message}`, "error");
    }
  }

  async getPageContext() {
    try {
      console.log("[App] Requesting page context...");

      // Get current tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || !tab.id) {
        throw new Error("No active tab found");
      }

      // Check if it's Google Docs
      if (tab.url && tab.url.includes("docs.google.com/document")) {
        console.log("[App] Google Docs detected, using script injection");

        // Use script injection for Google Docs
        const response = await chrome.runtime.sendMessage({
          type: "INJECT_GOOGLE_DOCS_EXTRACTOR",
          data: { tabId: tab.id },
        });

        if (response && response.success) {
          console.log(
            `[App] Injection successful: ${response.length} characters`
          );
          return {
            success: true,
            title: tab.title,
            url: tab.url,
            selectedText: "",
            mainContent: response.content,
            metadata: { isGoogleDocs: true },
          };
        } else {
          console.error("[App] Injection failed:", response?.error);
        }
      }

      // Fallback to regular content script approach
      const response = await chrome.runtime.sendMessage({
        type: "GET_PAGE_CONTEXT",
      });

      if (response && response.success !== false) {
        console.log("[App] Got page context:", response);
        return response;
      }

      // Final fallback
      return {
        success: true,
        title: tab.title,
        url: tab.url,
        selectedText: "",
        mainContent: "",
        metadata: {},
      };
    } catch (error) {
      console.error("[App] Failed to get page context:", error);
      return null;
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
    } else {
      messageEl.textContent = content;
    }

    this.elements.messagesContainer?.appendChild(messageEl);
    this.scrollToBottom();
  }

  showTypingIndicator() {
    const typingEl = document.createElement("div");
    typingEl.className = "typing-indicator";
    typingEl.id = `typing-${Date.now()}`;
    typingEl.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
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
