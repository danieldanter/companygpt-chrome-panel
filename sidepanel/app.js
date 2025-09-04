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
  }

  async initialize() {
    console.log("[App] Initializing CompanyGPT Chat...");

    try {
      // Initialize modules
      this.chatController = new ChatController();
      this.messageRenderer = new MessageRenderer();
      this.contextAnalyzer = new ContextAnalyzer();

      // Setup UI elements
      this.setupUIElements();

      // Setup event listeners
      this.setupEventListeners();

      // Check authentication
      await this.checkAuth();

      // Load initial context
      await this.loadPageContext();

      // Initialize chat
      await this.chatController.initialize();

      this.isInitialized = true;
      console.log("[App] Initialization complete");
    } catch (error) {
      console.error("[App] Initialization failed:", error);
      this.showError("Failed to initialize: " + error.message);
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
      btnMenu: document.getElementById("btn-menu"),

      // Chat elements
      messagesContainer: document.getElementById("chat-messages"),
      messageInput: document.getElementById("message-input"),
      sendButton: document.getElementById("send-button"),

      // Settings
      currentDomain: document.getElementById("current-domain"),
      useContext: document.getElementById("use-context"),
    };
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

    this.elements.btnMenu?.addEventListener("click", () => {
      this.showMenu();
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

  showMenu() {
    // Simple menu options
    const options = ["Neuer Chat", "Chat exportieren", "Über CompanyGPT"];

    const choice = prompt(
      "Menü:\n" + options.map((o, i) => `${i + 1}. ${o}`).join("\n")
    );

    if (choice === "1") {
      this.startNewChat();
    }
    // Add more menu actions as needed
  }

  async checkAuth() {
    console.log("[App] Checking authentication...");

    try {
      // First try using AuthService if available
      if (window.AuthService) {
        const isAuth = await window.AuthService.checkAuth();
        const domain = window.AuthService.getActiveDomain?.();

        this.updateAuthStatus(isAuth, domain);
        return isAuth;
      }

      // Fallback to message-based auth check
      const response = await chrome.runtime.sendMessage({
        type: "CHECK_AUTH",
      });

      if (response?.success && response?.isAuthenticated) {
        this.updateAuthStatus(true, response.domain);
        console.log("[App] User authenticated");
        return true;
      } else {
        this.updateAuthStatus(false);
        console.log("[App] User not authenticated");
        return false;
      }
    } catch (error) {
      console.error("[App] Auth check failed:", error);
      this.updateAuthStatus(false);
      return false;
    }
  }

  showLoginOverlay() {
    console.log("[App] Showing login overlay");

    // Show overlay
    if (this.elements.loginOverlay) {
      this.elements.loginOverlay.style.display = "flex";
    }

    // Blur background messages
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.classList.add("blurred");
    }

    // Disable input
    this.updateAuthStatus(false);
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

      // Try to build login URL using CONFIG
      if (window.CONFIG?.buildLoginUrl) {
        loginUrl = window.CONFIG.buildLoginUrl();
      }

      // If no URL, try to detect domain
      if (!loginUrl && window.CONFIG?.DOMAIN) {
        loginUrl = `https://${window.CONFIG.DOMAIN}.506.ai/de/login`;
      }

      // Fallback URL if no domain detected
      if (!loginUrl) {
        // Ask user for their company subdomain
        const subdomain = prompt(
          'Bitte gib deine Firmen-Subdomain ein (z.B. "firma" für firma.506.ai):'
        );

        if (subdomain) {
          loginUrl = `https://${subdomain}.506.ai/de/login`;
        } else {
          return;
        }
      }

      // Open login in new tab
      await chrome.tabs.create({ url: loginUrl });

      // Show check button and hint
      if (this.elements.btnLogin) {
        this.elements.btnLogin.style.display = "none";
      }
      if (this.elements.btnCheckAuth) {
        this.elements.btnCheckAuth.style.display = "block";
      }
      if (this.elements.loginHint) {
        this.elements.loginHint.style.display = "flex";
      }
    } catch (error) {
      console.error("[App] Failed to open login:", error);
      this.showError("Fehler beim Öffnen der Anmeldeseite");
    }
  }

  async recheckAuth() {
    console.log("[App] Rechecking authentication...");

    // Clear any cached auth state
    if (window.AuthService?.clearCache) {
      window.AuthService.clearCache();
    }

    const isAuthenticated = await this.checkAuth();

    if (isAuthenticated) {
      this.hideLoginOverlay();

      // Initialize chat if not already done
      if (!this.chatController?.isInitialized) {
        await this.loadPageContext();
        await this.chatController.initialize();
      }

      // Show success message
      this.elements.messagesContainer.innerHTML = `
        <div class="message assistant">
          Erfolgreich angemeldet! Ich kann dir jetzt bei Fragen zur aktuellen Seite helfen. ✨
        </div>
      `;
    } else {
      // Reset buttons if still not authenticated
      if (this.elements.btnLogin) {
        this.elements.btnLogin.style.display = "block";
      }
      if (this.elements.btnCheckAuth) {
        this.elements.btnCheckAuth.style.display = "none";
      }
      if (this.elements.loginHint) {
        this.elements.loginHint.style.display = "none";
      }

      alert(
        "Noch nicht angemeldet. Bitte melde dich zuerst bei CompanyGPT an."
      );
    }
  }

  updateAuthStatus(isAuthenticated, domain = null) {
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
    // Context is now handled internally, no visual indicator needed
    // Could add a subtle indicator in the input area if needed
  }

  async sendMessage() {
    const message = this.elements.messageInput?.value?.trim();
    if (!message) return;

    // Clear input and reset height
    this.elements.messageInput.value = "";
    this.elements.messageInput.style.height = "auto";

    // Add user message
    this.addMessage(message, "user");

    // Show typing indicator
    const typingId = this.showTypingIndicator();

    try {
      // TODO: Send to actual API
      // For now, simulate response
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Remove typing indicator
      this.removeTypingIndicator(typingId);

      // Add mock response
      this.addMessage(
        "Das ist eine Testantwort. Die API-Integration kommt als nächstes!",
        "assistant"
      );
    } catch (error) {
      console.error("[App] Failed to send message:", error);
      this.removeTypingIndicator(typingId);
      this.addMessage("Fehler beim Senden der Nachricht.", "error");
    }
  }

  addMessage(content, role = "assistant") {
    const messageEl = document.createElement("div");
    messageEl.className = `message ${role}`;
    messageEl.textContent = content;

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
      // Clear all messages except system message
      this.elements.messagesContainer.innerHTML = `
        <div class="message system">
          Neuer Chat gestartet. Ich kann dir bei Fragen zur aktuellen Seite helfen. ✨
        </div>
      `;
      this.chatController?.clearChat();
    }
  }

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
      default:
        console.log("[App] Unknown message type:", message.type);
    }
  }

  showError(message) {
    console.error("[App]", message);
    this.addMessage(message, "error");
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
