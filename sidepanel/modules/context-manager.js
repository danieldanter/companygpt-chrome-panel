// sidepanel/modules/context-manager.js - CLEANED VERSION
import { debounce } from "./utils.js";
export class ContextManager {
  constructor(app) {
    this.debug = window.Debug.create("context");
    this.app = app;

    // Use AppStore as single source of truth
    this.store = window.AppStore;

    // Track extraction method
    this.extractionMethod = null;

    // UI elements
    this.loadButton = null;
    this.contextBar = null;
    this.contextText = null;
    this.clearButton = null;

    this.pageChangeDebounce = null;

    // Setup state sync
    this.setupStateSync();

    // Monitor Gmail URL changes
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (
        changeInfo.url &&
        tab.active &&
        tab.url?.includes("mail.google.com")
      ) {
        const oldUrl = this.store.get("context.url");
        if (oldUrl && oldUrl !== changeInfo.url) {
          this.debug.log(
            "[ContextManager] Gmail URL changed, reloading context"
          );
          this.loadPageContext();
        }
      }
    });

    // Create debounced version of loadPageContext
    // This will wait 1 second after the last call before executing
    this.debouncedLoadContext = debounce(() => {
      this.loadPageContext();
    }, 1000);

    // Create debounced version of context updates
    // This will wait 500ms for rapid updates to finish
    this.debouncedContextUpdate = debounce((context) => {
      this.store.actions.setContext(context);
    }, 500);

    // Initialize everything
    this.init();
  }
  setupStateSync() {
    this.debug.log("[ContextManager] Setting up state sync...");

    // Subscribe to context changes from store
    this.store.subscribe("context.isLoaded", (isLoaded) => {
      if (isLoaded) {
        const context = this.store.get("context");
        this.showContextBar(context);
      } else {
        this.hideContextBar();
      }
    });

    // Subscribe to tab changes
    this.store.subscribe("tab.url", (url) => {
      if (url && url !== this.store.get("context.url")) {
        this.debug.log("[ContextManager] Tab URL changed via state:", url);
        this.onPageChange(url);
      }
    });
  }

  init() {
    this.debug.log("[ContextManager] Initializing...");

    // Get UI elements
    this.loadButton = document.getElementById("load-context-btn");
    this.contextBar = document.getElementById("context-bar");
    this.contextText = document.getElementById("context-text");
    this.clearButton = document.getElementById("clear-context");

    // Setup event listeners
    this.setupEventListeners();

    // Monitor page changes
    this.monitorPageChanges();

    this.debug.log("[ContextManager] Initialization complete");
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

  // context-manager.js - Update monitorPageChanges (around line 120)
  async monitorPageChanges() {
    let lastCheckedUrl = null;

    setInterval(async () => {
      const currentUrl = await this.getCurrentUrl();

      if (currentUrl && currentUrl !== lastCheckedUrl) {
        lastCheckedUrl = currentUrl;
        const contextUrl = this.store.get("context.url");

        if (contextUrl && currentUrl !== contextUrl) {
          this.debug.log("[ContextManager] Page changed:", currentUrl);

          // USE DEBOUNCED VERSION INSTEAD
          // OLD: this.onPageChange(currentUrl);
          this.debouncedOnPageChange(currentUrl); // NEW
        }
      }
    }, 2000);
  }

  // Add debounced version of onPageChange
  debouncedOnPageChange = debounce((newUrl) => {
    // Ignore OAuth redirects and login URLs
    if (newUrl.includes("/login/") || newUrl.includes("?code=")) {
      this.debug.log("[ContextManager] Ignoring OAuth redirect URL");
      return;
    }

    // Reset context when page changes
    this.clearContext();
    // Show subtle notification that context is available
    this.showContextAvailable();
  }, 1000); // Wait 1 second after URL stops changing

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
    // Clear any pending debounced call
    clearTimeout(this.pageChangeDebounce);

    // Ignore OAuth redirects and login URLs
    if (newUrl.includes("/login/") || newUrl.includes("?code=")) {
      this.debug.log("[ContextManager] Ignoring OAuth redirect URL");
      return;
    }

    this.pageChangeDebounce = setTimeout(() => {
      // Reset context when page changes
      this.clearContext();
      // Show subtle notification that context is available
      this.showContextAvailable();
    }, 1000); // Wait 1 second to ensure page is stable
  }

  showContextAvailable() {
    // Add a subtle pulse to the load button
    this.loadButton?.classList.add("context-available");
    setTimeout(() => {
      this.loadButton?.classList.remove("context-available");
    }, 3000);
  }

  async loadPageContext() {
    // Always clear old context first
    if (this.store.get("context.isLoaded")) {
      this.debug.log(
        "[ContextManager] Clearing old context before loading new"
      );
      this.clearContext();
    }

    this.debug.log("[ContextManager] Loading page context...");

    // Update UI state
    this.setButtonState("loading");
    this.store.set("ui.contextLoading", true);

    try {
      // Get page context
      const context = await this.extractPageContext();

      if (
        !context ||
        (Object.prototype.hasOwnProperty.call(context, "success") &&
          !context.success)
      ) {
        throw new Error(context?.error || "No context available");
      }

      // Process the context
      const processedContext = this.processContext(context);
      // ADD THIS DEBUG LOG
      this.debug.log(
        "[ContextManager] Processed context before store update:",
        {
          isEmail: processedContext.isEmail,
          isOutlook: processedContext.isOutlook,
          emailProvider: processedContext.emailProvider,
          isGmail: processedContext.isGmail,
        }
      );

      // Update store
      this.store.actions.setContext(processedContext);

      this.debug.log("[ContextManager] Store state after update:", {
        isEmail: this.store.get("context.isEmail"),
        isOutlook: this.store.get("context.isOutlook"),
        emailProvider: this.store.get("context.emailProvider"),
        isGmail: this.store.get("context.isGmail"),
      });

      // Update UI
      this.setButtonState("loaded");

      this.debug.log("[ContextManager] Context loaded successfully via store");
    } catch (error) {
      console.error("[ContextManager] Failed to load context:", error);
      this.setButtonState("error");

      // Add error to store
      this.store.actions.showError(`Failed to load context: ${error.message}`);

      // Reset after 3 seconds
      setTimeout(() => {
        this.setButtonState("default");
      }, 3000);
    } finally {
      this.store.set("ui.contextLoading", false);
    }
  }

  async extractPageContext() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || !tab.id) {
        throw new Error("No active tab found");
      }

      this.debug.log("[ContextManager] Extracting from:", tab.url);

      const strategy = await this.determineExtractionStrategy(tab);
      this.debug.log("[ContextManager] Using strategy:", strategy);

      let response;

      switch (strategy) {
        case "content-script":
          response = await this.extractViaContentScript(tab.id);
          break;

        case "injection":
          response = await this.extractViaInjection(tab.id);
          break;

        case "restricted":
          return {
            success: false,
            title: tab.title || "Restricted Page",
            url: tab.url,
            selectedText: "",
            mainContent: "",
            metadata: {
              extractionMethod: "restricted",
              message: "Content cannot be extracted from browser pages",
            },
          };

        default:
          throw new Error("Unable to extract content from this page");
      }

      // Check for enhancements needed
      if (
        response?.metadata?.needsApiExtraction ||
        response?.metadata?.needsExport
      ) {
        this.debug.log("[ContextManager] Content needs API enhancement");
        response = await this.enhanceWithApiData(response);
      }

      return response;
    } catch (error) {
      console.error("[ContextManager] Failed to extract context:", error);

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      return {
        success: false,
        title: tab?.title || "Unknown Page",
        url: tab?.url || "",
        selectedText: "",
        mainContent: `Unable to extract content: ${error.message}`,
        metadata: {
          extractionMethod: "failed",
          error: error.message,
        },
      };
    }
  }

  async determineExtractionStrategy(tab) {
    const url = new URL(tab.url);

    // Check if it's a restricted page
    if (
      url.protocol === "chrome:" ||
      url.protocol === "chrome-extension:" ||
      url.protocol === "about:"
    ) {
      return "none";
    }

    // List of sites with automatic content script injection
    const autoInjectedHosts = [
      "docs.google.com",
      "mail.google.com",
      "sharepoint.com",
      "office.com",
      "506.ai",
    ];

    // Check if content script should be loaded
    const hasAutoInjection = autoInjectedHosts.some((host) =>
      url.hostname.includes(host)
    );

    if (hasAutoInjection) {
      // Verify content script is actually loaded
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: "ping",
        });

        if (response && response.status === "ready") {
          return "content-script";
        }
      } catch (e) {
        this.debug.log(
          "[ContextManager] Content script not responding, will inject"
        );
      }
    }

    // For other sites or if content script isn't loaded
    return "injection";
  }

  async extractViaContentScript(tabId) {
    this.debug.log("[ContextManager] Extracting via content script");

    // Get model limit from store
    const modelLimit = this.store.get("chat.selectedModel.maxLength") || 190000;

    const response = await chrome.tabs.sendMessage(tabId, {
      action: "EXTRACT_CONTENT",
      options: {
        includeSelected: true,
        maxLength: modelLimit, // Use model limit, not 10000
        modelLimit: modelLimit,
      },
    });

    if (!response.success) {
      throw new Error(response.error || "Content extraction failed");
    }

    return {
      success: true,
      title: response.title,
      url: response.url,
      selectedText: response.selectedText || "",
      mainContent: response.content,
      metadata: response.metadata || {},
    };
  }

  async extractViaInjection(tabId) {
    this.debug.log("[ContextManager] Extracting via injection");

    // First check if content script is already there
    try {
      const pingResponse = await chrome.tabs.sendMessage(tabId, {
        action: "ping",
      });
      if (pingResponse && pingResponse.status === "ready") {
        this.debug.log(
          "[ContextManager] Content script already present, using it"
        );
        return await this.extractViaContentScript(tabId);
      }
    } catch (e) {
      // Not loaded, proceed with injection
    }

    // Try to inject our content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/content-script.js"],
      });

      this.debug.log("[ContextManager] Content script injected");

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now try content script method
      return await this.extractViaContentScript(tabId);
    } catch (injectionError) {
      console.error(
        "[ContextManager] Script injection failed:",
        injectionError
      );

      // Fallback to one-time injection with proper limit
      const modelLimit =
        this.store.get("chat.selectedModel.maxLength") || 190000;

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (limit) => {
          // Get all text content
          let fullText = document.body.innerText || "";

          // Apply smart truncation if needed
          if (fullText.length > limit) {
            // Try to cut at a sentence boundary
            fullText = fullText.substring(0, limit);
            const lastPeriod = fullText.lastIndexOf(".");
            if (lastPeriod > limit * 0.8) {
              fullText = fullText.substring(0, lastPeriod + 1);
            }
          }

          return {
            success: true,
            title: document.title,
            url: window.location.href,
            selectedText: window.getSelection().toString(),
            mainContent: fullText, // No arbitrary 5000 char limit!
            metadata: {
              method: "emergency-injection",
              originalLength: document.body.innerText.length,
              truncated: fullText.length < document.body.innerText.length,
            },
          };
        },
        args: [modelLimit],
      });

      return results[0].result;
    }
  }

  processContext(rawContext) {
    this.debug.log("[ContextManager] Processing context:", rawContext);

    // Clean and process the text content
    let textContent = "";
    if (rawContext?.mainContent) {
      textContent = this.cleanText(rawContext.mainContent);
    } else if (rawContext?.content) {
      // ADD THIS - sometimes it's in content not mainContent
      textContent = this.cleanText(rawContext.content);
    }

    // Selected text
    let selectedText = "";
    if (rawContext?.selectedText) {
      selectedText = this.cleanText(rawContext.selectedText);
    }

    // Word count
    const wordCount =
      textContent.trim().length > 0
        ? textContent.split(/\s+/).filter((w) => w.length > 0).length
        : 0;

    // Domain
    const domain = this.extractDomain(rawContext?.url);

    // Flags
    const url = rawContext?.url || "";
    const metadata = rawContext?.metadata || {}; // ADD THIS - get metadata

    const isGmail =
      !!metadata.isGmail || // Check metadata first
      rawContext?.pageType === "gmail" ||
      rawContext?.siteType === "gmail" ||
      rawContext?.hostname?.includes("mail.google.com") ||
      rawContext?.url?.includes("mail.google.com");

    // ADD THIS - Outlook detection
    const isOutlook =
      !!metadata.isOutlook || // Check metadata first
      metadata.emailProvider === "outlook" ||
      rawContext?.siteType === "outlook" ||
      rawContext?.hostname?.includes("outlook.office.com") ||
      rawContext?.hostname?.includes("outlook.live.com") ||
      rawContext?.url?.includes("outlook.office.com") ||
      rawContext?.url?.includes("outlook.live.com");

    // ADD THIS - Generic email flag
    const isEmail = !!metadata.isEmail || isGmail || isOutlook;

    // ADD THIS - Email provider
    const emailProvider =
      metadata.emailProvider ||
      (isOutlook ? "outlook" : isGmail ? "gmail" : null);

    const isGoogleDocs =
      !!metadata.isGoogleDocs ||
      rawContext?.pageType === "googleDocs" ||
      rawContext?.siteType === "google-docs" ||
      rawContext?.hostname?.includes("docs.google.com") ||
      rawContext?.url?.includes("docs.google.com");

    const extractionMethod =
      rawContext?.extractionMethod || metadata?.extractionMethod || "unknown";

    const processedContext = {
      title: rawContext?.title || "Untitled Page",
      url,
      domain,
      selectedText,
      mainContent: textContent,
      content: textContent,
      wordCount,
      timestamp: Date.now(),
      isGoogleDocs,
      isGmail,
      isOutlook, // ADD THIS
      isEmail, // ADD THIS
      emailProvider, // ADD THIS
      extractionMethod,
      metadata: {
        ...metadata, // Spread existing metadata
        isEmail, // Also include in metadata
        isOutlook, // Also include in metadata
        emailProvider, // Also include in metadata
      },
      summary: this.generateContentSummary(textContent),
    };

    this.debug.log("[ContextManager] Context processed:", {
      title: processedContext.title,
      domain: processedContext.domain,
      wordCount: processedContext.wordCount,
      hasSelectedText: !!processedContext.selectedText,
      isGoogleDocs: processedContext.isGoogleDocs,
      isGmail: processedContext.isGmail,
      isOutlook: processedContext.isOutlook, // ADD THIS to log
      isEmail: processedContext.isEmail, // ADD THIS to log
      emailProvider: processedContext.emailProvider, // ADD THIS to log
      method: processedContext.extractionMethod,
      contentLength: processedContext.mainContent.length,
    });
    this.debouncedContextUpdate(processedContext);
    return processedContext; // Make sure you have this return statement
  }

  async enhanceWithApiData(response) {
    this.debug.log("[ContextManager] Enhancing with API data");
    this.debug.log("[ContextManager] Metadata:", response.metadata);

    // Handle SharePoint documents
    if (
      response.metadata?.needsApiExtraction &&
      response.metadata?.isDocument
    ) {
      try {
        this.debug.log("[ContextManager] Calling SharePoint extraction API");

        const docResponse = await chrome.runtime.sendMessage({
          type: "EXTRACT_SHAREPOINT_DOCUMENT",
          data: {
            sourceDoc: response.metadata.sourceDoc,
            fileName: response.metadata.fileName,
            fileUrl: response.metadata.documentUrl || response.url,
            siteUrl: response.url,
          },
        });

        this.debug.log(
          "[ContextManager] SharePoint API response:",
          docResponse
        );

        if (docResponse && docResponse.success) {
          response.mainContent = docResponse.content;
          response.metadata.enhanced = true;
          response.metadata.method = docResponse.method || "sharepoint-api";
        } else {
          console.error(
            "[ContextManager] SharePoint extraction failed:",
            docResponse?.error
          );
          response.mainContent = `SharePoint Document: ${
            response.metadata.fileName
          }\n\nCould not extract content. Error: ${
            docResponse?.error || "Unknown error"
          }`;
        }
      } catch (error) {
        console.error(
          "[ContextManager] Failed to extract SharePoint doc:",
          error
        );
        response.mainContent = `SharePoint Document: ${response.metadata.fileName}\n\nExtraction error: ${error.message}`;
      }
    }

    // Handle Google Docs export
    if (response.metadata?.docId && response.metadata?.needsExport) {
      try {
        this.debug.log("[ContextManager] Calling Google Docs export API");

        const exportResponse = await chrome.runtime.sendMessage({
          type: "EXTRACT_GOOGLE_DOCS",
          data: { docId: response.metadata.docId },
        });

        this.debug.log(
          "[ContextManager] Google Docs export response:",
          exportResponse
        );

        if (exportResponse && exportResponse.success) {
          response.mainContent = exportResponse.content;
          response.metadata.enhanced = true;
          response.metadata.method = "google-docs-export";
        } else {
          console.error(
            "[ContextManager] Google Docs export failed:",
            exportResponse?.error
          );
        }
      } catch (error) {
        console.error("[ContextManager] Failed to export Google Doc:", error);
      }
    }

    return response;
  }

  cleanText(text) {
    if (!text) return "";

    return text
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .replace(/^\s+|\s+$/g, "")
      .trim();
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return "";
    }
  }

  generateContentSummary(content) {
    if (!content) return null;

    const words = content.split(/\s+/).filter((w) => w.length > 0);
    const sentences = content
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 0);

    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const potentialHeaders = lines
      .filter((line) => {
        const trimmed = line.trim();
        return (
          trimmed.length < 100 &&
          trimmed.length > 3 &&
          !trimmed.endsWith(".") &&
          !trimmed.endsWith(",")
        );
      })
      .slice(0, 5);

    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      potentialHeaders,
      firstParagraph: sentences[0] || "",
    };
  }

  setButtonState(state) {
    if (!this.loadButton) return;

    // Remove all state classes
    this.loadButton.classList.remove("loading", "loaded", "error");
    this.loadButton.setAttribute("data-state", state);

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

      default:
        this.loadButton.disabled = false;
        this.loadButton.title = "Load page context";
    }
  }

  showContextBar(context) {
    if (!this.contextBar || !this.contextText) return;

    // Build context info text
    let contextInfo = `${context.title || "Untitled"}`;

    if (context.wordCount > 0) {
      contextInfo += ` (${context.wordCount} Wörter)`;
    }

    // Get the action buttons container
    const actionsRow = document.getElementById("context-actions-row");

    // Check for ANY email provider (Gmail OR Outlook)
    if (context.isEmail || context.isGmail || context.isOutlook) {
      // Add provider to display
      if (context.isGmail) {
        contextInfo += ` • Gmail`;
      } else if (context.isOutlook) {
        contextInfo += ` • Outlook`;
      } else if (context.emailProvider) {
        contextInfo += ` • ${context.emailProvider}`;
      } else {
        contextInfo += ` • Email`;
      }

      this.store.set("ui.contextActionsVisible", true);
      if (actionsRow) {
        actionsRow.style.display = "flex";
        this.showEmailActions();
      }
    } else if (context.isGoogleDocs) {
      contextInfo += ` • Google Docs`;
      this.store.set("ui.contextActionsVisible", true);
      if (actionsRow) {
        actionsRow.style.display = "flex";
        this.showDocumentActions();
      }
    } else {
      this.store.set("ui.contextActionsVisible", false);
      if (actionsRow) {
        actionsRow.style.display = "none";
      }
    }

    // Update context text
    this.contextText.textContent = contextInfo;
    this.contextBar.style.display = "flex";

    // Update store
    this.store.set("ui.contextBarVisible", true);

    if (this.clearButton) {
      this.clearButton.style.display = "flex";
    }
  }

  hideContextBar() {
    if (this.contextBar) {
      this.contextBar.style.display = "none";
    }

    // Update store
    this.store.set("ui.contextBarVisible", false);
    this.store.set("ui.contextActionsVisible", false);

    // Hide action cards row
    const actionsRow = document.getElementById("context-actions-row");
    if (actionsRow) {
      actionsRow.style.display = "none";
    }
  }

  showEmailActions() {
    this.debug.log("[ContextManager] Showing email actions");

    // Get fresh references to buttons
    const buttons = document.querySelectorAll(".context-action-btn");

    if (buttons[0]) {
      buttons[0].dataset.action = "summarize";
      buttons[0].querySelector("span").textContent = "Zusammenfassen";
      buttons[0].style.display = "flex";
    }

    if (buttons[1]) {
      buttons[1].dataset.action = "reply";
      buttons[1].querySelector("span").textContent = "Antworten";
      buttons[1].style.display = "flex";
    }

    if (buttons[2]) {
      buttons[2].dataset.action = "reply-with-data";
      buttons[2].querySelector("span").textContent =
        "Mit Datenspeicher antworten";
      buttons[2].style.display = "flex";
    }
  }

  showDocumentActions() {
    this.debug.log("[ContextManager] Showing document actions");

    // Get fresh references to buttons
    const buttons = document.querySelectorAll(".context-action-btn");

    if (buttons[0]) {
      buttons[0].dataset.action = "summarize";
      buttons[0].querySelector("span").textContent = "Zusammenfassen";
      buttons[0].style.display = "flex";
    }

    if (buttons[1]) {
      buttons[1].dataset.action = "analyze";
      buttons[1].querySelector("span").textContent = "Analysieren";
      buttons[1].style.display = "flex";
    }

    if (buttons[2]) {
      buttons[2].dataset.action = "ask-questions";
      buttons[2].querySelector("span").textContent = "Fragen stellen";
      buttons[2].style.display = "flex";
    }
  }

  clearContext() {
    this.debug.log("[ContextManager] Clearing context via store");

    // Use store action to clear
    this.store.actions.clearContext();

    // Update UI
    this.setButtonState("default");
  }

  hasContext() {
    // Use store's computed property or direct check
    return (
      this.store.get("context.isLoaded") && this.store.get("context.content")
    );
  }

  getContextForMessage() {
    if (!this.store.get("context.isLoaded")) {
      return null;
    }

    const context = this.store.get("context");

    return {
      ...context,
      mainContent: context.content, // Ensure compatibility
      sourceType: this.detectSourceType(),
      isActive: this.isSourceStillActive(),
    };
  }

  detectSourceType() {
    const context = this.store.get("context");
    if (context?.isGmail) return "gmail";
    if (context?.isGoogleDocs) return "docs";
    if (context?.url?.includes("calendar.google.com")) return "calendar";
    return "web";
  }

  async isSourceStillActive() {
    // Check if the tab we extracted from is still open
    const contextUrl = this.store.get("context.url");
    const tabs = await chrome.tabs.query({});
    return tabs.some((tab) => tab.url === contextUrl);
  }

  getContextDisplay() {
    const context = this.store.get("context");
    if (!context || !context.isLoaded) {
      return "Kein Kontext verfügbar";
    }

    const { title, domain } = context;
    return `📄 ${title || "Unbenannte Seite"} (${domain})`;
  }
}
