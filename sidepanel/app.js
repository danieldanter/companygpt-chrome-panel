// sidepanel/app.js
import { ChatController } from "./modules/chat-controller.js";
import { MessageRenderer } from "./modules/message-renderer.js";
import { ContextAnalyzer } from "./modules/context-analyzer.js";

class CompanyGPTChat {
  constructor() {
    this.chatController = null;
    this.messageRenderer = null;
    this.contextAnalyzer = null;
    this.currentTabInfo = null;
    this.isInitialized = false;
    this.isAuthenticated = false; // Track auth state
    this.authCheckInProgress = false; // Prevent multiple auth checks

    // Session/context management
    this.lastKnownUrl = null;
    this.lastKnownDomain = null;
    this.sessionStartTime = null;
    this.hasShownContextDialog = false;
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

      // Load initial context
      await this.loadPageContext();

      // Check authentication (this will show login overlay if needed)
      this.isAuthenticated = await this.checkAuth();

      // Only initialize chat if authenticated
      if (this.isAuthenticated) {
        await this.initializeChat();

        // Check for existing session and context change
        await this.checkSessionContext();
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
      btnClose: document.getElementById("btn-close"),

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

    this.elements.btnClose?.addEventListener("click", () => {
      window.close();
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

    // Listen for tab changes
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      await this.handleTabChange(activeInfo.tabId);
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

    // Also listen for tab activation
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
    console.log("[App] Opening login page");

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
    console.log("[App] Rechecking authentication...");

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
  async checkAuth() {
    console.log("[App] Checking authentication...");

    try {
      let isAuth = false;
      let domain = null;

      // First try direct cookie check
      const hasCookie = await this.checkCookieDirectly();

      if (hasCookie) {
        isAuth = true;

        // Get domain from cookies
        const cookies = await chrome.cookies.getAll({
          domain: ".506.ai",
          name: "__Secure-next-auth.session-token",
        });

        if (cookies.length > 0) {
          domain = cookies[0].domain.replace(/^\./, "").replace(".506.ai", "");
        }
      } else if (window.AuthService) {
        // Fall back to AuthService
        isAuth = await window.AuthService.checkAuth();
        domain = window.AuthService.getActiveDomain?.();
      } else {
        // Final fallback to message-based auth check
        try {
          const response = await chrome.runtime.sendMessage({
            type: "CHECK_AUTH",
          });

          if (response?.success && response?.isAuthenticated) {
            isAuth = true;
            domain = response.domain;
          }
        } catch (msgError) {
          console.warn("[App] Message-based auth check failed:", msgError);
        }
      }

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

  // === CONTEXT / SESSION ===

  /**
   * Check if context has changed and show inline notification
   */
  async checkSessionContext() {
    console.log("[App] Checking session context...");

    try {
      // Get current page context
      const currentContext = await this.getPageContext();
      const currentUrl = currentContext?.url || "";
      const currentDomain = this.extractDomain(currentUrl);

      // Get stored session info
      const stored = await chrome.storage.local.get([
        "lastSessionUrl",
        "lastSessionDomain",
        "chatHistory",
      ]);

      console.log("[App] Current URL:", currentUrl);
      console.log("[App] Last session URL:", stored.lastSessionUrl);
      console.log(
        "[App] Chat history length:",
        stored.chatHistory?.length || 0
      );

      // If we have history and the domain/URL has changed significantly
      if (stored.chatHistory && stored.chatHistory.length > 0) {
        const contextChanged = this.hasContextChanged(
          currentUrl,
          currentDomain,
          stored.lastSessionUrl,
          stored.lastSessionDomain
        );

        if (contextChanged && !this.hasShownContextDialog) {
          console.log(
            "[App] Context has changed, showing inline notification..."
          );
          this.hasShownContextDialog = true;

          // Show inline notification instead of modal
          this.showContextChangeNotification(
            currentContext,
            stored.chatHistory
          );
        } else if (!contextChanged) {
          // Same context, restore the chat
          console.log("[App] Same context, restoring chat history...");
          this.restoreChatHistory(stored.chatHistory);
        }
      }

      // Store current context
      this.lastKnownUrl = currentUrl;
      this.lastKnownDomain = currentDomain;
      await chrome.storage.local.set({
        lastSessionUrl: currentUrl,
        lastSessionDomain: currentDomain,
      });
    } catch (error) {
      console.error("[App] Session context check failed:", error);
    }
  }

  /**
   * Check if context has changed significantly
   */
  hasContextChanged(currentUrl, currentDomain, lastUrl, lastDomain) {
    // Ignore chrome:// URLs
    if (
      currentUrl.startsWith("chrome://") &&
      lastUrl?.startsWith("chrome://")
    ) {
      return false;
    }

    // Different domains = context changed
    if (currentDomain !== lastDomain) {
      return true;
    }

    // Same domain but very different path
    if (currentDomain === lastDomain) {
      const currentPath = new URL(currentUrl).pathname;
      const lastPath = lastUrl ? new URL(lastUrl).pathname : "";

      // If paths are significantly different
      if (this.arePathsDifferent(currentPath, lastPath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if paths are significantly different
   */
  arePathsDifferent(path1, path2) {
    // Remove trailing slashes
    const p1 = path1.replace(/\/$/, "");
    const p2 = path2.replace(/\/$/, "");

    // Exact match = same
    if (p1 === p2) return false;

    // Check if they share the same base path
    const parts1 = p1.split("/").filter(Boolean);
    const parts2 = p2.split("/").filter(Boolean);

    // Different depth or first part different = different context
    if (parts1[0] !== parts2[0]) return true;

    return false;
  }

  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return "";
    }
  }

  /**
   * Show inline context change notification in chat
   */
  // Replace all context notification methods in app.js with this clean version

  /**
   * Show flat context notification (no double bubble)
   */
  showContextChangeNotification(currentContext, previousHistory) {
    console.log("[App] Showing context change notification");

    // Create flat notification - NOT wrapped in message bubble
    const notificationEl = document.createElement("div");
    notificationEl.className = "context-notification";
    notificationEl.innerHTML = `
      <div class="permission-title">Neuer Kontext erkannt</div>
      <div class="small">
        ${this.truncateUrl(currentContext?.url, 45)}
      </div>
      <div class="permission-buttons">
        <button class="tab">Neuer Chat</button>
        <button class="tab">Chat fortsetzen</button>
      </div>
    `;

    // Add directly to messages container (no wrapper)
    this.elements.messagesContainer?.appendChild(notificationEl);
    this.scrollToBottom();

    // Add event listeners
    const buttons = notificationEl.querySelectorAll(".tab");

    buttons[0]?.addEventListener("click", async () => {
      console.log("[App] User chose to start new chat");
      await this.clearAndStartNewChat();
      notificationEl.remove();
      this.addMessage("Chat wurde zurückgesetzt.", "assistant");
    });

    buttons[1]?.addEventListener("click", async () => {
      console.log("[App] User chose to continue chat");
      notificationEl.remove();
      this.restoreChatHistory(previousHistory);

      const divider = document.createElement("div");
      divider.className = "context-divider";
      divider.innerHTML = `<span>${this.truncateUrl(
        currentContext?.url,
        30
      )}</span>`;
      this.elements.messagesContainer?.appendChild(divider);
    });
  }

  /**
   * Show context notification when switching tabs
   */
  showCompactContextNotification() {
    if (document.querySelector(".context-notification")) {
      return;
    }

    const context = this.currentPageContext;

    const notificationEl = document.createElement("div");
    notificationEl.className = "context-notification";
    notificationEl.innerHTML = `
      <div class="permission-title">Neuer Kontext erkannt</div>
      <div class="small">
        ${this.truncateUrl(context?.url, 45)}
      </div>
      <div class="permission-buttons">
        <button class="tab" id="btn-new">Neuer Chat</button>
        <button class="tab" id="btn-continue">Chat fortsetzen</button>
      </div>
    `;

    this.elements.messagesContainer?.appendChild(notificationEl);
    this.scrollToBottom();

    const btnNew = notificationEl.querySelector("#btn-new");
    const btnContinue = notificationEl.querySelector("#btn-continue");

    btnNew?.addEventListener("click", async () => {
      await this.clearAndStartNewChat();
      notificationEl.remove();
      this.addMessage("Chat wurde zurückgesetzt.", "assistant");

      await chrome.storage.local.set({
        lastSessionUrl: context.url,
        lastSessionDomain: this.extractDomain(context.url),
      });
    });

    btnContinue?.addEventListener("click", async () => {
      notificationEl.remove();

      const divider = document.createElement("div");
      divider.className = "context-divider";
      divider.innerHTML = `<span>${this.truncateUrl(context?.url, 30)}</span>`;
      this.elements.messagesContainer?.appendChild(divider);

      await chrome.storage.local.set({
        lastSessionUrl: context.url,
        lastSessionDomain: this.extractDomain(context.url),
      });
    });
  }

  /**
   * Add subtle context change info
   */
  addContextChangeInfo(context) {
    const infoEl = document.createElement("div");
    infoEl.className = "context-change-info";
    infoEl.innerHTML = `
      <div class="context-divider">
        <span>📍 Neue Seite: ${context?.title || "Unbekannt"}</span>
      </div>
    `;
    this.elements.messagesContainer?.appendChild(infoEl);
    this.scrollToBottom();
  }

  /**
   * Clear chat and start fresh
   */
  async clearAndStartNewChat() {
    console.log("[App] Clearing and starting new chat");

    // Clear chat controller
    if (this.chatController) {
      await this.chatController.clearChat();
    }

    // Clear UI
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.innerHTML = "";
    }

    // Reset dialog flag
    this.hasShownContextDialog = false;
  }

  /**
   * Restore chat history to UI
   */
  restoreChatHistory(history) {
    console.log("[App] Restoring", history.length, "messages to UI");

    // Clear current UI
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.innerHTML = "";
    }

    // Add each message to UI
    history.forEach((msg) => {
      // Clean the content
      let content = msg.content;

      // Remove wrapper quotes if present
      if (content.startsWith('"') && content.endsWith('"')) {
        content = content.slice(1, -1);
      }

      // Replace escaped characters
      content = content
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .trim();

      // Don't show empty messages or pure context messages
      if (content && !content.startsWith("[Kontext:")) {
        // Remove context from user messages for display
        const contextIndex = content.indexOf("\n\n[Kontext:");
        if (contextIndex > -1) {
          content = content.substring(0, contextIndex);
        }

        this.addMessage(content, msg.role);
      }
    });

    // Scroll to bottom
    this.scrollToBottom();
  }

  /**
   * Truncate URL for display
   */
  truncateUrl(url) {
    if (!url) return "";
    if (url.length > 50) {
      return url.substring(0, 50) + "...";
    }
    return url;
  }

  // === CONTEXT ===
  async loadPageContext() {
    console.log("[App] Loading page context...");

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (tab) {
        this.currentPageContext = {
          title: tab.title,
          url: tab.url,
        };
        this.updateContextDisplay();
      }
    } catch (error) {
      console.error("[App] Failed to load context:", error);
    }
  }

  updateContextDisplay() {
    // Context is handled internally; add UI if needed later
  }

  // === CHAT ===
  // Update these methods in your app.js

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

    // NEW: Check for context change before sending message
    const shouldCheckContext = await this.checkForContextChange();
    if (shouldCheckContext) {
      console.log(
        "[App] Context change detected, waiting for user decision..."
      );
      // User will click a button which will handle the message
      // Store the message for later
      this.pendingMessage = message;
      this.elements.messageInput.value = message; // Keep it in input
      return;
    }

    // Continue with normal message sending
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
      console.log("[App] Getting page context...");

      // Get page context if enabled
      let context = null;
      if (this.elements.useContext?.checked !== false) {
        context = await this.getPageContext();
        console.log("[App] Page context:", context);
      }

      console.log("[App] Calling ChatController.sendMessage...");

      // Send to CompanyGPT API via ChatController
      const response = await this.chatController.sendMessage(message, context);

      console.log("[App] Got response:", response);

      // Remove typing indicator
      this.removeTypingIndicator(typingId);

      // Add assistant response
      this.addMessage(response.content, "assistant");

      // Update stored context after successful message
      const currentContext = await this.getPageContext();
      await chrome.storage.local.set({
        lastSessionUrl: currentContext?.url,
        lastSessionDomain: this.extractDomain(currentContext?.url),
      });
    } catch (error) {
      console.error("[App] Failed to send message:", error);
      this.removeTypingIndicator(typingId);
      this.addMessage(`Fehler: ${error.message}`, "error");
    }
  }

  async checkForContextChange() {
    // Only check if we have existing messages
    if (!this.chatController || this.chatController.messages.length === 0) {
      return false;
    }

    const currentContext = await this.getPageContext();
    const currentUrl = currentContext?.url || "";
    const currentDomain = this.extractDomain(currentUrl);

    // Get last known context
    const stored = await chrome.storage.local.get([
      "lastSessionUrl",
      "lastSessionDomain",
    ]);

    // Check if context changed
    const contextChanged = this.hasContextChanged(
      currentUrl,
      currentDomain,
      stored.lastSessionUrl,
      stored.lastSessionDomain
    );

    if (contextChanged && !this.hasShownContextDialog) {
      console.log("[App] Context changed, showing notification");
      this.hasShownContextDialog = true;

      // Show inline notification
      this.showContextChangeNotificationForMessage(currentContext);
      return true; // Stop message sending for now
    }

    return false;
  }

  showContextChangeNotificationForMessage(currentContext) {
    console.log("[App] Showing context change notification for new message");

    // Create compact notification exactly like permission request
    const notificationEl = document.createElement("div");
    notificationEl.className = "message assistant";
    notificationEl.innerHTML = `
      <div class="permission-request">
        <div>📍 Neuer Kontext erkannt</div>
        <div class="permission-text">
          ${this.truncateUrl(currentContext?.url, 40)}
        </div>
        <div class="permission-buttons">
          <button class="btn-allow" id="btn-use-new">Neuen Kontext verwenden</button>
          <button class="btn-deny" id="btn-keep-old">Alten behalten</button>
        </div>
      </div>
    `;

    // Add to messages container
    this.elements.messagesContainer?.appendChild(notificationEl);
    this.scrollToBottom();

    // Add event listeners
    const btnNew = notificationEl.querySelector("#btn-use-new");
    const btnKeep = notificationEl.querySelector("#btn-keep-old");

    btnNew?.addEventListener("click", async () => {
      console.log("[App] User chose to use new context");

      // Remove the notification
      notificationEl.remove();

      // Update stored context
      await chrome.storage.local.set({
        lastSessionUrl: currentContext.url,
        lastSessionDomain: this.extractDomain(currentContext.url),
      });

      // Add subtle marker
      const infoEl = document.createElement("div");
      infoEl.className = "context-change-info";
      infoEl.innerHTML = `
        <div class="context-divider">
          <span>📍 ${this.truncateUrl(currentContext?.url, 30)}</span>
        </div>
      `;
      this.elements.messagesContainer?.appendChild(infoEl);

      // Reset flag
      this.hasShownContextDialog = false;

      // Process the pending message with new context
      if (this.pendingMessage) {
        await this.processSendMessage(this.pendingMessage);
        this.pendingMessage = null;
      }
    });

    btnKeep?.addEventListener("click", async () => {
      console.log("[App] User chose to keep old context");

      // Remove the notification
      notificationEl.remove();

      // Reset flag but don't update stored context
      this.hasShownContextDialog = false;

      // Process the pending message without updating context
      if (this.pendingMessage) {
        await this.processSendMessage(this.pendingMessage);
        this.pendingMessage = null;
      }
    });
  }

  /**
   * Truncate URL for display with custom length
   */
  truncateUrl(url, maxLength = 50) {
    if (!url) return "";
    // Remove protocol
    let cleanUrl = url.replace(/^https?:\/\//, "");
    if (cleanUrl.length > maxLength) {
      return cleanUrl.substring(0, maxLength) + "...";
    }
    return cleanUrl;
  }

  // Also update handleTabChange to reset the flag
  async handleTabChange(tabId) {
    console.log("[App] Tab changed:", tabId);

    if (!this.isInitialized || !this.chatController?.isInitialized) {
      return;
    }

    const previousUrl = this.lastKnownUrl;
    await this.loadPageContext();
    const newUrl = this.currentPageContext?.url;

    // Check if we have messages and URL changed
    if (
      this.chatController?.messages?.length > 0 &&
      previousUrl &&
      newUrl &&
      previousUrl !== newUrl
    ) {
      console.log("[App] URL changed from", previousUrl, "to", newUrl);

      const contextChanged = this.hasContextChanged(
        newUrl,
        this.extractDomain(newUrl),
        previousUrl,
        this.extractDomain(previousUrl)
      );

      if (contextChanged) {
        console.log("[App] Context change detected, showing notification");
        this.showCompactContextNotification();
        this.lastKnownUrl = newUrl;
      }
    } else if (!this.lastKnownUrl) {
      this.lastKnownUrl = newUrl;
    }
  }

  async getPageContext() {
    try {
      console.log("[App] Requesting page context...");

      // Try to get context from content script
      const response = await chrome.runtime.sendMessage({
        type: "GET_PAGE_CONTEXT",
      });

      if (response && response.success !== false) {
        console.log("[App] Got page context:", response);
        return response;
      }

      // Fallback to basic tab info
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (tab) {
        const context = {
          title: tab.title,
          url: tab.url,
          selectedText: "",
          mainContent: "",
        };
        console.log("[App] Using tab context:", context);
        return context;
      }
    } catch (error) {
      console.error("[App] Failed to get page context:", error);
    }

    return null;
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
    await this.loadPageContext();
  }

  handleBackgroundMessage(message) {
    switch (message.type) {
      case "TAB_INFO":
        this.currentTabInfo = message.data;
        this.loadPageContext();
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
