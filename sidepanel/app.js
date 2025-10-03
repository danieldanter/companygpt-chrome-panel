// sidepanel/app.js - CLEANED VERSION
import { ChatController } from "./modules/chat-controller.js";
import { MessageRenderer } from "./modules/message-renderer.js";
import { ContextManager } from "./modules/context-manager.js";
import { DatenspeicherSelector } from "./modules/datenspeicher-selector.js";
import { ProcessMessage } from "./modules/process-message.js";
import { debounce } from "./modules/utils.js"; // ADD THIS LINE!
import { AudioRecorder } from "./modules/audio-recorder.js";

class CompanyGPTChat {
  constructor() {
    // Use AppStore as single source of truth
    this.store = window.AppStore;

    // Core modules
    this.chatController = null;
    this.messageRenderer = null;
    this.contextManager = null;
    this.processMessage = new ProcessMessage();
    this.audioRecorder = new AudioRecorder(this.store);
    this.uploadFolderId = null;

    // Cache UI element refs
    this.elements = {};

    // Setup state subscriptions
    this.setupStateSubscriptions();
  }

  setupStateSubscriptions() {
    console.log("[App] Setting up state subscriptions...");

    this.store.subscribe("chat.selectedModel", (model) => {
      console.log("[App] Model state changed:", model);
      this.updateModelIndicator();
    });
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

      await this.initializeModelSelection();

      // Setup UI elements FIRST
      this.setupUIElements();

      // Setup event listeners
      this.setupEventListeners();

      // Initialize ContextManager AFTER UI setup
      this.contextManager = new ContextManager(this);

      await this.initializeModelSelection();
      const currentModel = this.store.get("chat.selectedModel");
      if (currentModel) {
        const indicator = document.getElementById("model-indicator");
        if (indicator) {
          indicator.textContent = currentModel.name;
        }
      }

      // Initialize DatenspeicherSelector after ContextManager
      try {
        this.datenspeicherSelector = new DatenspeicherSelector(this.store);
        console.log("[App] DatenspeicherSelector initialized");
      } catch (dsErr) {
        console.warn(
          "[App] DatenspeicherSelector could not be initialized:",
          dsErr
        );
      }

      // 🔹 Initialize Upload View
      if (typeof this.initializeUploadView === "function") {
        await this.initializeUploadView();
        console.log("[App] Upload View initialized");
      } else {
        console.warn(
          "[App] initializeUploadView() not found — skipping Upload init"
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

  // Initialize model selection UI
  async initializeModelSelection() {
    console.log("[App] Initializing model selection...");

    const models = window.ModelsConfig.getAll();
    const currentModelId =
      this.store.get("settings.modelSelection.selectedModelId") ||
      "gemini-2.5-flash";
    const currentModel = window.ModelsConfig.getById(currentModelId);

    // Update dropdown button with current selection
    const dropdownButton = document.getElementById("model-dropdown-button");
    const dropdownMenu = document.getElementById("model-dropdown-menu");
    const currentDisplay = document.getElementById("model-dropdown-current");
    const tokensDisplay = document.getElementById("model-dropdown-tokens");

    if (!dropdownButton || !dropdownMenu) {
      console.warn("[App] Dropdown elements not found");
      return;
    }

    // Set current model display
    if (currentModel) {
      currentDisplay.textContent = currentModel.name;
      tokensDisplay.textContent = `${(currentModel.tokenLimit / 1000).toFixed(
        0
      )}k tokens`;
    }

    // Populate dropdown menu
    dropdownMenu.innerHTML = models
      .map(
        (model) => `
        <div class="model-dropdown-option ${
          model.id === currentModelId ? "selected" : ""
        }" 
            data-model-id="${model.id}">
          <span class="model-option-name">${model.name}</span>
          <span class="model-option-tokens">${(model.tokenLimit / 1000).toFixed(
            0
          )}k tokens</span>
          ${
            model.id === currentModelId
              ? '<span class="model-option-check">✓</span>'
              : ""
          }
        </div>
      `
      )
      .join("");

    // Remove existing event listeners to prevent duplicates
    const newDropdownButton = dropdownButton.cloneNode(true);
    dropdownButton.parentNode.replaceChild(newDropdownButton, dropdownButton);

    // Toggle dropdown
    newDropdownButton.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = dropdownMenu.style.display !== "none";
      dropdownMenu.style.display = isOpen ? "none" : "block";
      newDropdownButton.classList.toggle("open", !isOpen);
      console.log("[App] Dropdown toggled:", !isOpen ? "open" : "closed");
    });

    // Handle selection - use event delegation
    dropdownMenu.addEventListener("click", (e) => {
      const option = e.target.closest(".model-dropdown-option");
      if (!option) return;

      const modelId = option.dataset.modelId;
      console.log("[App] Model option clicked:", modelId);

      this.handleModelChange(modelId);
      dropdownMenu.style.display = "none";
      newDropdownButton.classList.remove("open");

      // Update dropdown button display immediately
      const model = window.ModelsConfig.getById(modelId);
      if (model) {
        const currentDisplay = document.getElementById(
          "model-dropdown-current"
        );
        const tokensDisplay = document.getElementById("model-dropdown-tokens");

        if (currentDisplay) currentDisplay.textContent = model.name;
        if (tokensDisplay) {
          tokensDisplay.textContent = `${(model.tokenLimit / 1000).toFixed(
            0
          )}k tokens`;
        }

        // Update selected state in dropdown
        dropdownMenu
          .querySelectorAll(".model-dropdown-option")
          .forEach((opt) => {
            opt.classList.remove("selected");
            const check = opt.querySelector(".model-option-check");
            if (check) check.remove();
          });

        option.classList.add("selected");
        if (!option.querySelector(".model-option-check")) {
          option.insertAdjacentHTML(
            "beforeend",
            '<span class="model-option-check">✓</span>'
          );
        }
      }
    });

    // Close dropdown when clicking outside - use capture phase
    document.addEventListener(
      "click",
      (e) => {
        const dropdownButton = document.getElementById("model-dropdown-button");
        const dropdownMenu = document.getElementById("model-dropdown-menu");

        if (
          dropdownButton &&
          dropdownMenu &&
          !dropdownButton.contains(e.target) &&
          !dropdownMenu.contains(e.target)
        ) {
          dropdownMenu.style.display = "none";
          dropdownButton.classList.remove("open");
        }
      },
      true
    ); // Use capture phase

    console.log("[App] Model selection dropdown initialized");
  }

  showNotification(message, type = "info") {
    console.log(`[App] ${type.toUpperCase()}: ${message}`);

    // Create a temporary notification element
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 60px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === "success" ? "#22c55e" : "#0ea5e9"};
      color: white;
      border-radius: 8px;
      z-index: 1000;
      animation: slideIn 0.3s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = "0";
      notification.style.transform = "translateX(100px)";
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
  // Handle model selection change
  handleModelChange(modelId) {
    console.log("[App] Model changed to:", modelId);

    const model = window.ModelsConfig.getById(modelId);
    if (!model) {
      console.error("[App] Invalid model ID:", modelId);
      return;
    }

    // Update settings in store
    this.store.set("settings.modelSelection.selectedModelId", modelId);
    this.store.set("settings.modelSelection.lastChanged", Date.now());

    // Update chat state with full model object
    this.store.set("chat.selectedModel", {
      id: model.id,
      name: model.name,
      maxLength: model.maxLength,
      tokenLimit: model.tokenLimit,
    });

    // Show confirmation
    this.showNotification(
      `Sprachmodell gewechselt zu ${model.name}`,
      "success"
    );

    // Update indicator immediately
    this.updateModelIndicator();

    console.log("[App] Model change complete");
  }

  // Update model indicator in chat header
  // Update model indicator in chat header
  updateModelIndicator() {
    // Get the model from the store (single source of truth)
    const model = this.store.get("chat.selectedModel");
    console.log("[App] Updating model indicator with model:", model?.name);

    const indicatorById = document.getElementById("model-indicator");
    const indicatorByClass = document.querySelector(
      ".header-left .model-indicator"
    );

    console.log("[App] Found by ID:", indicatorById);
    console.log("[App] Found by class:", indicatorByClass);

    if (indicatorById && model) {
      indicatorById.textContent = model.name;
      // Force attribute update to prevent any caching issues
      indicatorById.setAttribute("data-model-id", model.id);
    }
    if (indicatorByClass && model) {
      indicatorByClass.textContent = model.name;
      indicatorByClass.setAttribute("data-model-id", model.id);
    }

    // No need for the setTimeout check - trust the state
  }

  async initializeUploadView() {
    console.log("[App] Initializing upload view...");

    // Initialize AudioRecorder
    this.audioRecorder = new AudioRecorder(this.store);

    // Initialize with UI elements
    this.audioRecorder.init({
      recordButton: document.getElementById("btn-record"),
      timerDisplay: document.querySelector(".recording-time .time-display"),
      playbackControls: document.getElementById("playback-controls"),
      audioPlayer: document.getElementById("audio-player"),
      uploadButton: document.getElementById("btn-upload-audio"),
      filenameInput: document.getElementById("upload-filename"),
    });

    // Set up event listeners
    this.setupUploadListeners();

    // Generate default filename
    this.updateDefaultFilename();

    console.log("[App] Upload view initialized");
  }

  // In app.js, add these methods to your CompanyGPTChat class:

  async initializeUploadView() {
    console.log("[App] Initializing upload view...");

    // Initialize AudioRecorder
    this.audioRecorder = new AudioRecorder(this.store);

    // Initialize with UI elements
    this.audioRecorder.init({
      recordButton: document.getElementById("btn-record"),
      timerDisplay: document.querySelector(".recording-time .time-display"),
      playbackControls: document.getElementById("playback-controls"),
      audioPlayer: document.getElementById("audio-player"),
      uploadButton: document.getElementById("btn-upload-audio"),
      filenameInput: document.getElementById("upload-filename"),
    });

    // Set up event listeners
    this.setupUploadListeners();

    // Generate default filename
    this.updateDefaultFilename();

    console.log("[App] Upload view initialized");
  }

  setupUploadListeners() {
    // Tab switching
    document.querySelectorAll(".upload-tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        // Remove active from all tabs and contents
        document
          .querySelectorAll(".upload-tab")
          .forEach((t) => t.classList.remove("active"));
        document
          .querySelectorAll(".tab-content")
          .forEach((c) => (c.style.display = "none"));

        // Add active to clicked tab
        tab.classList.add("active");
        const tabName = tab.dataset.tab;
        const content = document.querySelector(`[data-content="${tabName}"]`);
        if (content) {
          content.style.display = "block";
        }

        // Update store
        this.store.set("upload.activeTab", tabName);
      });
    });

    // Record button
    document
      .getElementById("btn-record")
      ?.addEventListener("click", async () => {
        if (this.audioRecorder.mediaRecorder?.state === "recording") {
          this.audioRecorder.stopRecording();
        } else if (this.audioRecorder.audioBlob) {
          // Has recording, start new one
          this.audioRecorder.reset();
          await this.audioRecorder.startRecording();
        } else {
          // Start recording
          await this.audioRecorder.startRecording();
        }
      });

    // In setupUploadListeners, add:
    document.addEventListener("click", (e) => {
      const uploadDropdown = document.getElementById(
        "upload-datenspeicher-dropdown"
      );
      const uploadButton = document.getElementById("upload-folder-select");

      if (
        uploadDropdown &&
        !uploadDropdown.contains(e.target) &&
        !uploadButton.contains(e.target)
      ) {
        uploadDropdown.classList.remove("show");
      }
    });

    // Upload audio button
    document
      .getElementById("btn-upload-audio")
      ?.addEventListener("click", () => {
        this.uploadAudio();
      });

    // Delete audio button
    document
      .getElementById("btn-delete-audio")
      ?.addEventListener("click", () => {
        this.audioRecorder.reset();
      });

    // Folder selection
    document
      .getElementById("upload-folder-select")
      ?.addEventListener("click", () => {
        this.openFolderSelector();
      });

    // URL crawl button
    document.getElementById("btn-crawl-url")?.addEventListener("click", () => {
      this.crawlUrl();
    });

    // Filename input - update store on change
    document
      .getElementById("upload-filename")
      ?.addEventListener("input", (e) => {
        this.store.set("upload.filename", e.target.value);
      });
  }

  updateDefaultFilename() {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(
      now.getHours()
    ).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(
      now.getSeconds()
    ).padStart(2, "0")}`;
    const filename = `aufnahme-${timestamp}`;

    const input = document.getElementById("upload-filename");
    if (input) {
      input.value = filename;
      this.store.set("upload.filename", filename);
    }
  }

  async openFolderSelector() {
    console.log("[App] Opening upload folder selector");
    const button = document.getElementById("upload-folder-select");
    if (!button) return;

    // Check if dropdown exists
    let dropdown = button.parentElement.querySelector(
      ".datenspeicher-dropdown"
    );
    if (!dropdown) {
      dropdown = document.createElement("div");
      dropdown.className = "datenspeicher-dropdown";
      dropdown.innerHTML = `
        <div class="dropdown-list">
          <div class="dropdown-loading">Lade Datenspeicher...</div>
        </div>
      `;
      button.parentElement.appendChild(dropdown);
    }

    // Toggle visibility
    dropdown.classList.toggle("show");

    if (dropdown.classList.contains("show")) {
      const list = dropdown.querySelector(".dropdown-list");

      try {
        const data = await window.APIService.fetchFolders();

        // FIX: Extract folders from the data object
        const folders = data?.folders || [];

        console.log("[App] Folders loaded:", folders.length);

        if (folders.length > 0) {
          const mediaFolders = folders.filter((f) => f.type === "MEDIA");
          if (mediaFolders.length > 0) {
            list.innerHTML = mediaFolders
              .map(
                (folder) => `
                <div class="dropdown-item" data-folder-id="${folder.id}">
                  <span class="dropdown-item-name">${folder.name}</span>
                </div>
              `
              )
              .join("");
          } else {
            list.innerHTML =
              '<div class="dropdown-empty">Keine Datenspeicher gefunden</div>';
          }
        } else {
          list.innerHTML =
            '<div class="dropdown-empty">Keine Datenspeicher gefunden</div>';
        }
      } catch (error) {
        console.error("[App] Failed to load folders:", error);
        list.innerHTML = '<div class="dropdown-error">Fehler beim Laden</div>';
      }

      // Simple click handler
      list.onclick = (e) => {
        const item = e.target.closest(".dropdown-item");
        if (!item) return;

        const folderId = item.dataset.folderId;
        const folderName = item.textContent.trim();

        // Update UI
        const textEl = document.getElementById("upload-folder-text");
        if (textEl) textEl.textContent = folderName;

        // Store selection
        this.uploadFolderId = folderId;
        this.store?.set?.("upload.selectedFolderId", folderId);

        // Close dropdown
        dropdown.classList.remove("show");
        console.log("[App] Selected:", folderName, folderId);
      };
    }

    // Close on outside click
    setTimeout(() => {
      document.addEventListener("click", function closeHandler(e) {
        if (!button.contains(e.target) && !dropdown.contains(e.target)) {
          dropdown.classList.remove("show");
          document.removeEventListener("click", closeHandler);
        }
      });
    }, 10);
  }

  setupEventListeners() {
    // Icon button navigation
    this.elements.btnChat?.addEventListener("click", () => {
      this.showView("chat");
      this.setActiveButton("btnChat");
    });

    this.elements.btnUpload = document.getElementById("btn-upload");
    this.elements.viewUpload = document.getElementById("view-upload");

    this.elements.btnUpload?.addEventListener("click", () => {
      this.showView("upload");
      this.setActiveButton("btnUpload");
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

    // --- Typing indicators (debounced) ---
    this.showUserTyping = debounce(() => {
      // Could send typing status to backend
      console.log("[App] User is typing...");
      this.store.set("chat.userTyping", true);
    }, 300);

    this.hideUserTyping = debounce(() => {
      console.log("[App] User stopped typing");
      this.store.set("chat.userTyping", false);
    }, 1000);

    // Auto-resize textarea with debounced typing indicators
    this.elements.messageInput?.addEventListener("input", (e) => {
      // Immediate resize (keep responsive)
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px";

      // Debounced typing indicators
      this.showUserTyping();
      this.hideUserTyping();
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

      // Ignore OAuth redirects
      if (url && (url.includes("/login/") || url.includes("?code="))) {
        console.log("[App] Ignoring OAuth redirect URL:", url);
        return;
      }

      tabChangeTimeout = setTimeout(async () => {
        if (url === lastProcessedUrl) {
          console.log("[App] Skipping duplicate tab change for:", url);
          return;
        }

        lastProcessedUrl = url;
        console.log("[App] Processing tab change:", url);

        if (this.contextManager) {
          if (!url?.startsWith("chrome://") && !url?.startsWith("about:")) {
            // Use the debounced loader on the ContextManager
            this.contextManager.debouncedLoadContext();
          }
        }
      }, 1000); // 1 second delay
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

    // Context action buttons — UPDATED for split button & safe handling
    document.addEventListener("click", (e) => {
      // 1) Datenspeicher: reply-with-data
      const dsButton = e.target.closest(
        '.context-action-btn[data-action="reply-with-data"]'
      );
      if (dsButton) {
        e.preventDefault();
        e.stopPropagation();
        const hasSelection = dsButton.classList.contains("has-selection");
        const clickedElement = e.target;
        const isDropdownClick = clickedElement.closest(".button-dropdown");
        const isMainClick = clickedElement.closest(".button-main");
        if (!hasSelection) {
          if (this.datenspeicherSelector) {
            this.datenspeicherSelector.open();
          }
        } else {
          if (isDropdownClick) {
            if (this.datenspeicherSelector) {
              this.datenspeicherSelector.open();
            }
          } else if (isMainClick) {
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

      // 2) Plain reply button (toggle context mode or call helper)
      const replyButton = e.target.closest(
        '.context-action-btn[data-action="reply"]'
      );
      if (replyButton) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof this.activateReplyMode === "function") {
          this.activateReplyMode(replyButton);
        } else {
          const isActive = replyButton.classList.contains("context-active");
          const contextInput = replyButton.parentElement.querySelector(
            ".reply-context-input"
          );
          if (!isActive) {
            replyButton.classList.add("context-active");
            const spanLabel = replyButton.querySelector("span");
            if (spanLabel) spanLabel.textContent = "Kontext hinzufügen...";
            if (contextInput) {
              contextInput.style.display = "flex";
              contextInput.querySelector("input")?.focus();
            }
          } else {
            this.handleContextAction("reply");
            replyButton.classList.remove("context-active");
            const span = replyButton.querySelector("span");
            if (span) span.textContent = "Antworten";
            if (contextInput) {
              contextInput.style.display = "none";
              const input = contextInput.querySelector("input");
              if (input) input.value = "";
            }
          }
        }
        return;
      }

      // 3) Other context action buttons (e.g., summarize)
      const otherButton = e.target.closest(".context-action-btn");
      if (otherButton) {
        const action = otherButton.dataset.action;
        if (action !== "reply-with-data" && action !== "reply") {
          this.handleContextAction(action);
        }
      }
    });

    // Email configuration inputs
    const emailSenderInput = document.getElementById("email-sender-name");
    const emailSignatureInput = document.getElementById("email-signature");

    // Load saved values
    emailSenderInput.value =
      this.store.get("settings.emailConfig.senderName") || "";
    emailSignatureInput.value =
      this.store.get("settings.emailConfig.signature") || "";

    // Save on change with debouncing
    const saveEmailConfig = debounce(() => {
      this.store.set("settings.emailConfig.senderName", emailSenderInput.value);
      this.store.set(
        "settings.emailConfig.signature",
        emailSignatureInput.value
      );
      console.log("[App] Email config saved:", {
        senderName: emailSenderInput.value,
        signature: emailSignatureInput.value,
      });
    }, 500);

    emailSenderInput?.addEventListener("input", saveEmailConfig);
    emailSignatureInput?.addEventListener("input", saveEmailConfig);

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

  activateReplyMode() {
    console.log("[App] Activating reply mode");

    // Mark that we're in reply mode
    this.store.set("ui.replyMode", true);

    // Add green glow to Antworten button
    const replyBtn = document.querySelector('button[data-action="reply"]');
    if (replyBtn) {
      replyBtn.classList.add("active-reply");
    }

    // Change input placeholder and focus
    if (this.elements.messageInput) {
      this.elements.messageInput.placeholder =
        "Stichworte eingeben (z.B. Sonntag 08:00-21:00, Preise)...";
      this.elements.messageInput.focus();
      this.elements.messageInput.classList.add("reply-mode");

      // Add a data attribute to mark reply mode
      this.elements.messageInput.dataset.replyMode = "true";
    }

    // Click outside to cancel
    this.outsideClickHandler = (e) => {
      if (
        !e.target.closest(".input-container") &&
        !e.target.closest('button[data-action="reply"]')
      ) {
        this.deactivateReplyMode();
      }
    };
    setTimeout(() => {
      document.addEventListener("click", this.outsideClickHandler);
    }, 100);
  }

  deactivateReplyMode() {
    console.log("[App] Deactivating reply mode");

    this.store.set("ui.replyMode", false);

    // Remove green glow
    const replyBtn = document.querySelector('button[data-action="reply"]');
    if (replyBtn) {
      replyBtn.classList.remove("active-reply");
    }

    // Reset input
    if (this.elements.messageInput) {
      this.elements.messageInput.placeholder = "Nachricht an CompanyGPT";
      this.elements.messageInput.classList.remove("reply-mode");
      delete this.elements.messageInput.dataset.replyMode;
    }

    if (this.outsideClickHandler) {
      document.removeEventListener("click", this.outsideClickHandler);
    }
  }

  setActiveButton(buttonName) {
    // Remove active class from ALL buttons
    this.elements.btnChat?.classList.remove("active");
    this.elements.btnUpload?.classList.remove("active");
    this.elements.btnSettings?.classList.remove("active");

    // Add active class to selected button
    this.elements[buttonName]?.classList.add("active");
  }

  showView(which) {
    // Hide all views
    this.elements.viewChat?.style.setProperty("display", "none");
    this.elements.viewUpload?.style.setProperty("display", "none");
    this.elements.viewSettings?.style.setProperty("display", "none");

    // Hide input area for non-chat views
    const inputArea = document.querySelector(".input-area");

    switch (which) {
      case "chat":
        this.elements.viewChat?.style.removeProperty("display");
        if (inputArea) inputArea.style.display = "flex"; // Show input area for chat
        break;
      case "upload":
        this.elements.viewUpload?.style.removeProperty("display");
        if (inputArea) inputArea.style.display = "none"; // Hide input area for upload
        break;
      case "settings":
        this.elements.viewSettings?.style.removeProperty("display");
        if (inputArea) inputArea.style.display = "none"; // Hide input area for settings
        break;
    }

    // Store current view
    this.store.set("ui.activeView", which);
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

  async processSendMessage(inputText = null) {
    const text = inputText || this.elements?.messageInput?.value?.trim();
    if (!text) return;

    console.log("[App] User sending message:", text);

    // Check Reply Mode (set elsewhere in the UI/store)
    const isReplyMode = this.store.get("ui.replyMode") === true;
    console.log("[App] Reply mode active?", isReplyMode);

    // Clear any preserved intent from previous operations
    // UNLESS this is a reply mode activation / flow
    if (!isReplyMode) {
      this.store.set("chat.currentIntent", null);
      console.log("[App] Cleared preserved intent for new user message");
    }

    // ===== Reply Mode: Turn user's keywords into an email reply =====
    if (isReplyMode) {
      console.log("[App] Processing as email reply with keywords");

      // Deactivate reply mode first
      if (typeof this.deactivateReplyMode === "function") {
        this.deactivateReplyMode();
      } else {
        this.store.set("ui.replyMode", false);
      }

      // Clear the input if the user typed into the box
      if (!inputText && this.elements?.messageInput) {
        this.elements.messageInput.value = "";
      }

      // Require email context
      const context = this.contextManager?.getContextForMessage();
      const isEmailContext =
        !!context?.isEmail ||
        !!context?.isGmail ||
        !!context?.isOutlook ||
        !!context?.emailProvider;

      if (!context || !isEmailContext) {
        this.showError("Email-Kontext nicht verfügbar");
        return;
      }

      // Build prompt that injects the user's keywords/focus
      const originalEmailText =
        context?.selectedText ||
        context?.content ||
        context?.mainContent ||
        context?.emailBody ||
        "";

      const prompt = `Beantworte diese Email professionell und freundlich.
  Verwende dabei folgende wichtige Informationen/Schlüsselwörter: ${text}

  Original-Email:
  ${originalEmailText}

  Anweisungen:
  - Beantworte nur die explizit gestellten Fragen der Original-Email
  - Nutze ausschließlich die relevanten Informationen aus den angegebenen Schlüsselwörtern und dem Emailtext
  - Sei freundlich und professionell
  - Schreibe eine vollständige, kurze Email-Antwort (keine unnötigen Zusatzinfos)`;

      // Show a lightweight UX message
      this.addMessage(`Email-Antwort mit Infos: ${text}`, "user");

      // Ensure chat is ready
      if (!this.chatController || !this.chatController.isInitialized) {
        console.log("[App] Initializing chat for reply");
        try {
          await this.initializeChat();
        } catch (error) {
          console.error("[App] Failed to initialize chat:", error);
          this.showError("Chat konnte nicht initialisiert werden");
          return;
        }
      }

      // Set email-reply intent BEFORE sending
      this.store.set("chat.lastUserIntent", "email-reply");
      this.store.set("chat.currentIntent", "email-reply");

      // Show thinking indicator
      const thinkingId = this.showTypingIndicator();
      try {
        // Send with explicit email-reply intent
        const response = await this.chatController.sendMessage(
          prompt,
          context,
          "email-reply"
        );

        // Remove thinking indicator
        this.removeTypingIndicator(thinkingId);

        if (response && response._isError) {
          this.addMessage(
            response.content || "⚠️ Fehlerhafte Antwort vom Sprachmodell.",
            "error"
          );
          return;
        }

        if (response && response.content) {
          const messageId = this.startStreamingMessage();
          await this.streamText(messageId, response.content, 3);
        } else {
          this.addMessage("⚠️ Keine Antwort erhalten.", "error");
        }
      } catch (error) {
        console.error("[App] Failed to send email reply:", error);
        this.removeTypingIndicator(thinkingId);
        this.showError("Fehler beim Generieren der Email-Antwort");
      }

      return; // Exit early – do not continue with normal flow
    }

    // ===== Normal message flow =====
    console.log("[App] Processing message:", text);

    // Add user message to UI
    this.addMessage(text, "user");

    // Show thinking indicator
    const thinkingId = this.showTypingIndicator();

    try {
      // Include context if present
      let context = null;
      if (this.contextManager && this.contextManager.hasContext()) {
        context = this.contextManager.getContextForMessage();
        console.log("[App] Including context with message");
      }

      // Detect intent only for email contexts
      let intent = null;
      const isEmailContext =
        !!context?.isEmail ||
        !!context?.isGmail ||
        !!context?.isOutlook ||
        !!context?.emailProvider;

      if (isEmailContext) {
        const lowerMessage = (text || "").toLowerCase();
        if (
          lowerMessage.includes("beantworte") ||
          lowerMessage.includes("antwort") ||
          lowerMessage.includes("reply")
        ) {
          intent = "email-reply";
          this.store.set("chat.lastUserIntent", intent);
          this.store.set("chat.currentIntent", intent);
        }
      }

      console.log("[App] Sending to chat controller with intent:", intent);
      const response = await this.chatController.sendMessage(
        text,
        context,
        intent
      );

      // Remove thinking indicator
      this.removeTypingIndicator(thinkingId);

      if (response && response._isError) {
        this.addMessage(
          response.content || "⚠️ Fehlerhafte Antwort vom Sprachmodell.",
          "error"
        );
        return;
      }

      if (!response || !response.content) {
        this.addMessage("⚠️ Keine Antwort erhalten.", "error");
        return;
      }

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
            ✨ Chat bereit! Du kannst jetzt Fragen stellen.
          </div>
        `;
      }
    } catch (error) {
      console.error("[App] Chat initialization failed:", error);
      throw error;
    }
  }

  addMessage(content, role = "assistant") {
    // Special handling for process messages
    if (role === "process") {
      const messageEl = this.processMessage.addToChat(
        this.elements.messagesContainer,
        content
      );
      this.scrollToBottom();
      return messageEl;
    }
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
          replyBtn.onclick = () => this.handleEmailReply(content);
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

    // Ensure scroll after adding message
    requestAnimationFrame(() => {
      const chatContainer = document.getElementById("view-chat");
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    });
  }

  // Change this method from handleGmailReply to handleEmailReply
  // Change this method from handleGmailReply to handleEmailReply
  async handleEmailReply(content) {
    console.log("[App] Handling email reply");

    const context = this.store.get("context");
    const emailProvider = context?.emailProvider || "unknown";

    console.log(`[App] Email provider: ${emailProvider}`);

    const emailData = this.parseEmailContent(content);
    console.log("[App] Parsed email data:", emailData);

    try {
      // Get the CURRENTLY ACTIVE tab
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (activeTab) {
        console.log(`[App] Current active tab:`, activeTab.url);

        // Check if it's an email tab
        const isEmailTab =
          activeTab.url?.includes("mail.google.com") ||
          activeTab.url?.includes("outlook.office.com") ||
          activeTab.url?.includes("outlook.live.com");

        if (isEmailTab) {
          console.log(`[App] Inserting into current tab (${emailProvider})`);

          // Send message to the CURRENT tab's content script
          try {
            const response = await chrome.tabs.sendMessage(activeTab.id, {
              action: "INSERT_EMAIL_REPLY",
              data: emailData,
              provider: emailProvider,
            });

            console.log("[App] Insert response:", response);

            if (response?.success) {
              if (
                response.method === "clipboard" ||
                response.method === "clipboard-ready"
              ) {
                this.showNotification(`✅ ${response.message}`, "success");
              } else {
                this.showNotification(
                  "✅ Email-Antwort wurde eingefügt!",
                  "success"
                );
              }
            } else if (response?.content) {
              await navigator.clipboard.writeText(response.content);
              this.showNotification(
                "📋 Email kopiert! Bitte manuell einfügen (Strg+V)",
                "info"
              );
            }
          } catch (err) {
            console.log("[App] Content script not ready, injecting...");

            // Try to inject content script if it's not there
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ["content/content-script.js"],
            });

            // Wait and retry
            await new Promise((resolve) => setTimeout(resolve, 500));

            const response = await chrome.tabs.sendMessage(activeTab.id, {
              action: "INSERT_EMAIL_REPLY",
              data: emailData,
              provider: emailProvider,
            });

            console.log("[App] Insert response (retry):", response);
          }
        } else {
          // Current tab is not an email tab
          await navigator.clipboard.writeText(content);
          this.showNotification(
            "📋 Bitte wechsle zu deinem Email-Tab. Antwort wurde kopiert!",
            "info"
          );
        }
      }
    } catch (error) {
      console.error("[App] Error handling email reply:", error);
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(content);
        this.showNotification(
          "📋 Email wurde in die Zwischenablage kopiert!",
          "info"
        );
      } catch (clipErr) {
        this.showError("Fehler beim Kopieren der Email");
      }
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

    // Strip surrounding quotes if present
    if (processedContent.startsWith('"') && processedContent.endsWith('"')) {
      processedContent = processedContent.slice(1, -1);
    }

    // Normalize escaped newlines
    processedContent = processedContent.replace(/\\n\\n\\n\\n/g, "\n\n");
    processedContent = processedContent.replace(/\\n\\n\\n/g, "\n\n");
    processedContent = processedContent.replace(/\\n\\n/g, "\n\n");
    processedContent = processedContent.replace(/\\n/g, "\n");

    // Render markdown (fallback to simple <br> replacement)
    const finalHTML = this.messageRenderer
      ? this.messageRenderer.renderMarkdown(processedContent)
      : processedContent.replace(/\n/g, "<br>");

    // Convert to plain text for smooth character-by-character streaming
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = finalHTML;
    const plainText = tempDiv.textContent || tempDiv.innerText || "";

    // Helper: smooth scroll during streaming
    const scrollDuringStream = () => {
      const chatContainer = document.getElementById("view-chat");
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      } else if (typeof this.scrollToBottom === "function") {
        this.scrollToBottom();
      }
    };

    // Stream out the text
    let currentText = "";
    for (let i = 0; i < plainText.length; i++) {
      currentText += plainText[i];
      messageEl.innerHTML = `${currentText.replace(
        /\n/g,
        "<br>"
      )}<span class="streaming-cursor">▊</span>`;

      // Scroll every 10 characters during streaming
      if (i % 10 === 0) {
        scrollDuringStream();
      }

      await new Promise((resolve) => setTimeout(resolve, speed));
    }

    // After streaming completes and buttons are added
    messageEl.className = "message assistant";
    messageEl.innerHTML = finalHTML;

    const intent =
      this.store.get("chat.lastUserIntent") ||
      this.store.get("chat.currentIntent");

    console.log("[App] Stream complete, checking intent:", intent);

    // Also check if the last user message was a Datenspeicher request for email
    const messages = this.store.get("chat.messages") || [];
    const lastUserMessage = messages.filter((m) => m.role === "user").pop();
    const wasEmailDatanspeicher =
      lastUserMessage?._datenspeicherRequest &&
      (lastUserMessage?._originalIntent === "email-reply" ||
        this.store.get("context.isEmail"));

    // ... add buttons logic ...
    if (intent === "email-reply" || wasEmailDatanspeicher) {
      console.log(
        "[App] Adding email action buttons (intent or Datenspeicher email detected)"
      );
      this.addEmailActionButtons(messageEl, content);
    }

    // IMPORTANT: Clear the intent after use!
    // Only preserve it during the operation, not forever
    this.store.set("chat.currentIntent", null);
    console.log("[App] Cleared current intent after streaming");

    // Final scroll after streaming complete
    requestAnimationFrame(() => {
      scrollDuringStream();
      setTimeout(scrollDuringStream, 250);
    });
  }

  // Add this new method after streamText
  addEmailActionButtons(messageEl, originalContent) {
    const alreadyWrapped = messageEl.querySelector(".message-with-actions");
    if (alreadyWrapped) return; // Don't add twice

    const buttonsDiv = document.createElement("div");
    buttonsDiv.className = "action-buttons email-actions";
    buttonsDiv.dataset.messageContent = originalContent; // Store the content

    // Primary actions row
    const primaryActions = document.createElement("div");
    primaryActions.className = "action-buttons-row primary";

    // Copy button
    const copyBtn = this.createActionButton(
      "copy",
      "Kopieren",
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>`,
      () => this.handleCopyAction(originalContent)
    );

    // Reply button
    const replyBtn = this.createActionButton(
      "gmail-reply",
      "Als Antwort einfügen",
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 10 4 15 9 20"></polyline>
        <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
      </svg>`,
      () => this.handleEmailReply(originalContent)
    );

    primaryActions.appendChild(copyBtn);
    primaryActions.appendChild(replyBtn);

    // Variation actions row
    const variationActions = document.createElement("div");
    variationActions.className = "action-buttons-row variations";

    // Formeller button
    const formellerBtn = this.createActionButton(
      "formeller",
      "Formeller",
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L12 14"></path>
        <path d="M7 8L12 14L17 8"></path>
        <path d="M5 22h14"></path>
      </svg>`,
      () => this.handleVariation(originalContent, "formeller")
    );

    // Informeller button
    const informellerBtn = this.createActionButton(
      "informeller",
      "Informeller",
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
        <line x1="9" y1="9" x2="9.01" y2="9"></line>
        <line x1="15" y1="9" x2="15.01" y2="9"></line>
      </svg>`,
      () => this.handleVariation(originalContent, "informeller")
    );

    // Kürzer button
    const kuerzerBtn = this.createActionButton(
      "kuerzer",
      "Kürzer",
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="5 12 9 12 9 12 19 12"></polyline>
        <polyline points="15 8 19 12 15 16"></polyline>
        <polyline points="9 16 5 12 9 8"></polyline>
      </svg>`,
      () => this.handleVariation(originalContent, "kuerzer")
    );

    // Länger button
    const laengerBtn = this.createActionButton(
      "laenger",
      "Länger",
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 12 5 12 5 12 5 12"></polyline>
        <polyline points="19 12 19 12 19 12 15 12"></polyline>
        <polyline points="9 8 5 12 9 16"></polyline>
        <polyline points="15 16 19 12 15 8"></polyline>
      </svg>`,
      () => this.handleVariation(originalContent, "laenger")
    );

    variationActions.appendChild(formellerBtn);
    variationActions.appendChild(informellerBtn);
    variationActions.appendChild(kuerzerBtn);
    variationActions.appendChild(laengerBtn);

    buttonsDiv.appendChild(primaryActions);
    buttonsDiv.appendChild(variationActions);

    // Wrap existing content and add buttons
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
    requestAnimationFrame(() => {
      this.scrollToBottom();
    });
  }

  // Helper method to create action buttons
  createActionButton(className, label, svgIcon, onClick) {
    const button = document.createElement("button");
    button.className = `action-btn ${className}-btn`;
    button.innerHTML = `${svgIcon} <span>${label}</span>`;
    button.onclick = onClick;
    return button;
  }

  // Handle copy action
  async handleCopyAction(content) {
    try {
      await navigator.clipboard.writeText(content);
      // Visual feedback
      event.target.closest(".action-btn").innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M20 6L9 17l-5-5"></path>
        </svg>
        <span>Kopiert!</span>
      `;
      event.target.closest(".action-btn").classList.add("success");

      setTimeout(() => {
        event.target.closest(".action-btn").innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>Kopieren</span>
        `;
        event.target.closest(".action-btn").classList.remove("success");
      }, 2000);
    } catch (err) {
      console.error("[App] Copy failed:", err);
    }
  }

  // Handle variation requests
  async handleVariation(originalContent, variation) {
    console.log(`[App] Requesting ${variation} variation`);

    // Create the appropriate user message
    let userMessage = "";
    switch (variation) {
      case "formeller":
        userMessage = "Bitte schreibe die E-Mail formeller";
        break;
      case "informeller":
        userMessage = "Bitte schreibe die E-Mail informeller";
        break;
      case "kuerzer":
        userMessage = "Bitte kürze die E-Mail";
        break;
      case "laenger":
        userMessage = "Bitte schreibe die E-Mail ausführlicher";
        break;
    }

    // Add user message to chat
    this.addMessage(userMessage, "user");

    // Show thinking indicator
    const thinkingId = this.showTypingIndicator();

    try {
      // Build context with the original email
      const variationContext = {
        content: originalContent,
        isVariationRequest: true,
        variationType: variation,
      };

      // Build the full prompt
      const prompt = `${userMessage}. 

  Vorherige E-Mail-Antwort:
  ${originalContent}

  Bitte behalte alle wichtigen Informationen bei, aber passe den Stil entsprechend an.`;

      // Send to chat controller
      const response = await this.chatController.sendMessage(
        prompt,
        variationContext
      );

      // Remove thinking indicator
      this.removeTypingIndicator(thinkingId);

      // Stream the response with action buttons
      const messageId = this.startStreamingMessage();
      await this.streamText(messageId, response?.content || "", 3);
    } catch (error) {
      console.error(`[App] Failed to create ${variation} variation:`, error);
      this.removeTypingIndicator(thinkingId);
      this.showError(`Fehler beim Erstellen der ${variation}en Version`);
    }
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

    // Scroll to show the indicator
    const chatContainer = document.getElementById("view-chat");
    if (chatContainer) {
      requestAnimationFrame(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      });
    } else {
      this.scrollToBottom?.();
    }

    return typingEl.id;
  }

  removeTypingIndicator(id) {
    document.getElementById(id)?.remove();
  }

  scrollToBottom() {
    // Get the CORRECT scrollable container
    const chatContainer = document.getElementById("view-chat");

    if (chatContainer) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;

        // Fallback: try again after a short delay for streaming content
        setTimeout(() => {
          chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 100);
      });
    }
  }

  async handleTabChange(tabId) {
    console.log("[App] Tab changed:", tabId);
    this.contextManager?.loadPageContext();
  }

  // app.js - Update handleBackgroundMessage (around line 1265)
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
      case "STATE_SYNC":
        // ✅ Handle state sync messages (already handled by StateManager)
        // Just acknowledge it's a known message type
        break;
      default:
        console.log("[App] Unknown message type:", message.type);
    }
  }

  showError(message) {
    // Add a fallback if message is undefined
    const errorMessage = message || "Ein Fehler ist aufgetreten";

    console.error("[App]", errorMessage);

    if (this.elements.messagesContainer) {
      const errorEl = document.createElement("div");
      errorEl.className = "message error";
      errorEl.textContent = errorMessage;
      this.elements.messagesContainer.appendChild(errorEl);
      this.scrollToBottom();
    }
  }

  async handleContextAction(action) {
    console.log("[App] Context action:", action);

    // Get context
    const context = this.contextManager?.getContextForMessage();
    console.log("[App] Context retrieved:", context);

    // --- Existing validation ---
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

    // --- Context flags ---
    const isEmail =
      !!context?.isEmail ||
      !!context?.isGmail ||
      !!context?.isOutlook ||
      context?.emailProvider ||
      context?.sourceType === "email";

    const isGoogleDocs =
      !!context?.isGoogleDocs || context?.sourceType === "docs";

    const isDocumentLike =
      isGoogleDocs || !!context?.isDocument || !!context?.isPage;

    // --- Intent handling via helper ---
    // If determineIntentForAction is not defined, fallback to previous logic
    const intent =
      typeof this.determineIntentForAction === "function"
        ? this.determineIntentForAction(action)
        : (() => {
            if (action === "reply" || action === "reply-with-data")
              return "email-reply";
            if (action === "summarize")
              return isEmail ? "email-summary" : "document-summary";
            return "general";
          })();

    // Start lifecycle (sets/locks any needed state internally)
    if (typeof this.manageIntentLifecycle === "function") {
      this.manageIntentLifecycle("start", intent);
    }

    console.log("[App] Setting intent for action:", action, "->", intent);

    // --- Build query text ---
    let query = "";

    switch (action) {
      case "summarize":
        if (isEmail) {
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
        if (!isEmail) {
          this.showError("Diese Aktion ist nur für E-Mails verfügbar.");
          if (button) button.classList.remove("loading");
          if (typeof this.manageIntentLifecycle === "function") {
            this.manageIntentLifecycle("complete");
          }
          return;
        }
        query =
          "Bitte beantworte mir diese Email professionell und freundlich.";
        break;

      case "reply-with-data":
        if (!isEmail) {
          this.showError("Diese Aktion ist nur für E-Mails verfügbar.");
          if (button) button.classList.remove("loading");
          if (typeof this.manageIntentLifecycle === "function") {
            this.manageIntentLifecycle("complete");
          }
          return;
        }
        // Text hints that Datenspeicher flow will follow
        query =
          "Bitte beantworte mir diese Email und nutze dabei relevante Informationen aus unserem Datenspeicher.";
        break;

      case "analyze":
        if (!isDocumentLike) {
          this.showError("Diese Aktion ist für Dokumente gedacht.");
          if (button) button.classList.remove("loading");
          if (typeof this.manageIntentLifecycle === "function") {
            this.manageIntentLifecycle("complete");
          }
          return;
        }
        query =
          "Bitte analysiere dieses Dokument und gib mir eine detaillierte Einschätzung.";
        break;

      case "ask-questions":
        if (!isDocumentLike) {
          this.showError("Diese Aktion ist für Dokumente gedacht.");
          if (button) button.classList.remove("loading");
          if (typeof this.manageIntentLifecycle === "function") {
            this.manageIntentLifecycle("complete");
          }
          return;
        }
        query =
          "Bitte erstelle mir wichtige Fragen zu diesem Dokument, die ich beantworten sollte.";
        break;

      default:
        console.error("[App] Unknown action:", action);
        if (button) button.classList.remove("loading");
        if (typeof this.manageIntentLifecycle === "function") {
          this.manageIntentLifecycle("complete");
        }
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
      console.log("  Intent:", intent);

      // Pass the intent to the chat controller
      const response = await this.chatController.sendMessage(
        query,
        context,
        intent
      );

      this.removeTypingIndicator(thinkingId);

      const messageId = this.startStreamingMessage();
      await this.streamText(messageId, response?.content || "", 3);
    } catch (error) {
      console.error("[App] Failed to process context action:", error);
      this.showError(`Fehler: ${error.message}`);
    } finally {
      if (button) button.classList.remove("loading");
      // End lifecycle (clears transient intent/state)
      if (typeof this.manageIntentLifecycle === "function") {
        this.manageIntentLifecycle("complete");
      }
    }
  }

  manageIntentLifecycle(phase, intent = null) {
    switch (phase) {
      case "start":
        // Starting an action (email reply, summarize, etc.)
        this.store.set("chat.currentIntent", intent);
        this.store.set("chat.intentPhase", "active");
        console.log(`[App] Intent lifecycle: Started ${intent}`);
        break;

      case "complete":
        // Action completed, clear intent
        this.store.set("chat.currentIntent", null);
        this.store.set("chat.intentPhase", "idle");
        console.log("[App] Intent lifecycle: Completed, intent cleared");
        break;

      case "check":
        // Check if we're in an active intent phase
        return this.store.get("chat.intentPhase") === "active";
    }
  }

  // Add this method to your CompanyGPTChat class in app.js
  // Place it after the handleContextAction method
  async handleDatenspeicherReply(selection) {
    this.manageIntentLifecycle("start", "email-reply");
    console.log(
      "[App] Datenspeicher selected for multi-step reply:",
      selection
    );

    // Get context
    const context = this.contextManager?.getContextForMessage();
    if (!context) {
      this.showError("Bitte lade zuerst den Seitenkontext");
      return;
    }

    const isEmail =
      !!context?.isEmail ||
      !!context?.isGmail ||
      !!context?.isOutlook ||
      context?.emailProvider;

    if (!isEmail) {
      this.showError("Diese Aktion ist nur für E-Mails verfügbar.");
      return;
    }

    // --- Auth & chat controller checks (existing behavior) ---
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

    const query = `Bitte beantworte mir diese Email und nutze dabei relevante Informationen aus dem Datenspeicher "${selection.folderName}".`;

    try {
      if (this.elements?.messageInput) {
        this.elements.messageInput.value = "";
      }

      // Add user message to chat UI
      this.addMessage(query, "user");

      // IMPORTANT: Also add to store's chat messages AND set intent
      const userMessage = {
        id: `msg-${Date.now()}-user`,
        role: "user",
        content: query,
        timestamp: Date.now(),
        _context: context,
        _datenspeicherRequest: true,
        _folderId: selection.folderId,
        _folderName: selection.folderName,
        _originalIntent: "email-reply", // preserve original intent
      };

      const currentMessages = this.store.get("chat.messages") || [];
      this.store.set("chat.messages", [...currentMessages, userMessage]);

      // FORCE email-reply intent for email contexts with Datenspeicher
      this.store.set("chat.lastUserIntent", "email-reply");
      this.store.set("chat.currentIntent", "email-reply");

      console.log(
        "[App] Starting multi-step Datenspeicher process with email-reply intent"
      );

      // Pass the intent explicitly to the controller
      const response = await this.chatController.sendDatanspeicherReply(
        query,
        context,
        selection.folderId,
        selection.folderName,
        "email-reply" // pass intent explicitly
      );

      // Show process card if present
      if (response && response.processData) {
        this.addMessage(response.processData, "process");
      }

      // Only show response if not aborted and content exists
      if (response && response.content) {
        // Add assistant response to store
        const assistantMessage = {
          id: `msg-${Date.now()}-assistant`,
          role: "assistant",
          content: response.content,
          timestamp: Date.now(),
          _fromDatanspeicher: true,
          _folderId: selection.folderId,
        };

        const updatedMessages = this.store.get("chat.messages") || [];
        this.store.set("chat.messages", [...updatedMessages, assistantMessage]);

        // Stream the response in UI
        const messageId = this.startStreamingMessage();
        await this.streamText(messageId, response.content, 3);
      }

      // Ensure intent remains correctly set after response
      this.store.set("chat.lastUserIntent", "email-reply");

      console.log("[App] Multi-step Datenspeicher reply completed");
    } catch (error) {
      console.error("[App] Failed to process Datenspeicher reply:", error);
      this.showError(`Fehler: ${error.message}`);
    }
    this.manageIntentLifecycle("complete");
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
