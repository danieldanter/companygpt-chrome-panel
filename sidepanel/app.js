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

      // Tabs
      tabChat: document.getElementById("tab-chat"),
      tabSettings: document.getElementById("tab-settings"),

      // Chat elements
      messagesContainer: document.getElementById("chat-messages"),
      messageInput: document.getElementById("message-input"),
      sendButton: document.getElementById("send-button"),

      // Status elements
      pageContext: document.getElementById("page-context"),
      authStatus: document.getElementById("auth-status"),
      currentDomain: document.getElementById("current-domain"),

      // Buttons
      btnNewChat: document.getElementById("btn-new-chat"),
      btnSettings: document.getElementById("btn-settings"),

      // Settings
      modeContext: document.getElementById("mode-context"),
    };
  }

  setupEventListeners() {
    // Tab switching
    this.elements.tabChat?.addEventListener("click", () =>
      this.showView("chat")
    );
    this.elements.tabSettings?.addEventListener("click", () =>
      this.showView("settings")
    );
    this.elements.btnSettings?.addEventListener("click", () =>
      this.showView("settings")
    );

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
      e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
    });

    // New chat
    this.elements.btnNewChat?.addEventListener("click", () =>
      this.startNewChat()
    );

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message) => {
      this.handleBackgroundMessage(message);
    });

    // Listen for tab changes
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      await this.handleTabChange(activeInfo.tabId);
    });
  }

  showView(which) {
    const isChat = which === "chat";

    this.elements.viewChat?.classList.toggle("active", isChat);
    this.elements.viewSettings?.classList.toggle("active", !isChat);
    this.elements.tabChat?.classList.toggle("active", isChat);
    this.elements.tabSettings?.classList.toggle("active", !isChat);
  }

  async checkAuth() {
    console.log("[App] Checking authentication...");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "CHECK_AUTH",
      });

      if (response?.success && response?.isAuthenticated) {
        this.updateAuthStatus(true, response.domain);
        console.log("[App] User authenticated");
      } else {
        this.updateAuthStatus(false);
        console.log("[App] User not authenticated");
      }
    } catch (error) {
      console.error("[App] Auth check failed:", error);
      this.updateAuthStatus(false);
    }
  }

  updateAuthStatus(isAuthenticated, domain = null) {
    if (this.elements.authStatus) {
      this.elements.authStatus.innerHTML = isAuthenticated
        ? "🟢 Verbunden"
        : "🔴 Nicht verbunden";
    }

    if (this.elements.currentDomain && domain) {
      this.elements.currentDomain.textContent = domain + ".506.ai";
    }

    // Enable/disable chat based on auth
    if (this.elements.messageInput) {
      this.elements.messageInput.disabled = !isAuthenticated;
      this.elements.messageInput.placeholder = isAuthenticated
        ? "Wie kann ich dir heute helfen?"
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
    if (this.elements.pageContext && this.currentPageContext) {
      const { title, url } = this.currentPageContext;
      const contextValue =
        this.elements.pageContext.querySelector(".context-value");
      if (contextValue) {
        contextValue.textContent = title || "Aktuelle Seite";
        contextValue.title = url;
      }
    }
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
    messageEl.className = `msg ${role}`;
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
    if (this.elements.viewChat) {
      this.elements.viewChat.scrollTop = this.elements.viewChat.scrollHeight;
    }
  }

  startNewChat() {
    if (
      confirm("Neuen Chat starten? Die aktuelle Unterhaltung wird gelöscht.")
    ) {
      // Clear all messages except system message
      this.elements.messagesContainer.innerHTML = `
        <div class="msg system">
          Neuer Chat gestartet. Wie kann ich dir helfen? ✨
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
