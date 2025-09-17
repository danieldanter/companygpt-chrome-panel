// sidepanel/modules/context-manager.js
export class ContextManager {
  constructor(app) {
    this.app = app;
    this.currentContext = null;
    this.isLoaded = false;
    this.lastUrl = null;

    // Track extraction method
    this.extractionMethod = null;

    // UI elements
    this.loadButton = null;
    this.contextBar = null;
    this.contextText = null;
    this.clearButton = null;

    // Initialize everything
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

    console.log("[ContextManager] Initialization complete");
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

  async extractPageContext() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || !tab.id) {
        throw new Error("No active tab found");
      }

      console.log("[ContextManager] Extracting from:", tab.url);

      const strategy = await this.determineExtractionStrategy(tab);
      console.log("[ContextManager] Using strategy:", strategy);

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

      // CHECK FOR ENHANCEMENTS NEEDED
      if (
        response?.metadata?.needsApiExtraction ||
        response?.metadata?.needsExport
      ) {
        console.log("[ContextManager] Content needs API enhancement");
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
        console.log(
          "[ContextManager] Content script not responding, will inject"
        );
      }
    }

    // For other sites or if content script isn't loaded
    return "injection";
  }

  async extractViaContentScript(tabId) {
    console.log("[ContextManager] Extracting via content script");

    const response = await chrome.tabs.sendMessage(tabId, {
      action: "EXTRACT_CONTENT",
      options: {
        includeSelected: true,
        maxLength: 10000,
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
    console.log("[ContextManager] Extracting via injection");

    // First, try to inject our content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/content-script.js"],
      });

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now try content script method
      return await this.extractViaContentScript(tabId);
    } catch (injectionError) {
      console.error(
        "[ContextManager] Script injection failed:",
        injectionError
      );

      // Fallback to one-time injection
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Minimal extraction for fallback
          return {
            success: true,
            title: document.title,
            url: window.location.href,
            selectedText: window.getSelection().toString(),
            mainContent: document.body.innerText.substring(0, 5000),
            metadata: {
              method: "emergency-injection",
            },
          };
        },
      });

      return results[0].result;
    }
  }

  async extractViaHybrid(tabId) {
    console.log("[ContextManager] Extracting via hybrid approach");

    // Get initial content from content script
    const contentResponse = await this.extractViaContentScript(tabId);

    // Enhance with API data if needed
    if (contentResponse.metadata?.needsExport) {
      return await this.enhanceWithApiData(contentResponse);
    }

    return contentResponse;
  }

  async extractViaInjection(tabId) {
    console.log("[ContextManager] Extracting via injection");

    // First check if content script is already there
    try {
      const pingResponse = await chrome.tabs.sendMessage(tabId, {
        action: "ping",
      });
      if (pingResponse && pingResponse.status === "ready") {
        console.log(
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

      console.log("[ContextManager] Content script injected");

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now try content script method
      return await this.extractViaContentScript(tabId);
    } catch (injectionError) {
      console.error(
        "[ContextManager] Script injection failed:",
        injectionError
      );

      // Fallback to one-time injection
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Minimal extraction for fallback
          return {
            success: true,
            title: document.title,
            url: window.location.href,
            selectedText: window.getSelection().toString(),
            mainContent: document.body.innerText.substring(0, 5000),
            metadata: {
              method: "emergency-injection",
            },
          };
        },
      });

      return results[0].result;
    }
  }

  processContext(rawContext) {
    console.log("[ContextManager] Processing context:", rawContext);

    // Clean and process the text content
    let textContent = "";
    if (rawContext?.mainContent) {
      textContent = this.cleanText(rawContext.mainContent);
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
    const pageType = rawContext?.pageType || "";
    const isGmail =
      !!rawContext?.metadata?.isGmail ||
      rawContext?.pageType === "gmail" ||
      rawContext?.siteType === "gmail" || // Add this check
      rawContext?.hostname?.includes("mail.google.com") || // Add this check
      rawContext?.url?.includes("mail.google.com");

    const isGoogleDocs =
      !!rawContext?.metadata?.isGoogleDocs ||
      rawContext?.pageType === "googleDocs" ||
      rawContext?.siteType === "google-docs" || // Add this check
      rawContext?.hostname?.includes("docs.google.com") || // Add this check
      rawContext?.url?.includes("docs.google.com");

    const extractionMethod =
      rawContext?.extractionMethod ||
      rawContext?.metadata?.extractionMethod ||
      "unknown";

    const processedContext = {
      title: rawContext?.title || "Untitled Page",
      url,
      domain,
      selectedText,
      mainContent: textContent,
      wordCount,
      timestamp: Date.now(),
      isGoogleDocs,
      isGmail, // Make sure this is included
      extractionMethod,
      metadata: rawContext?.metadata || {},
      summary: this.generateContentSummary(textContent),
    };

    console.log("[ContextManager] Context processed:", {
      title: processedContext.title,
      domain: processedContext.domain,
      wordCount: processedContext.wordCount,
      hasSelectedText: !!processedContext.selectedText,
      isGoogleDocs: processedContext.isGoogleDocs,
      isGmail: processedContext.isGmail,
      method: processedContext.extractionMethod,
      contentLength: processedContext.mainContent.length,
    });
    console.log(
      "[ContextManager] Context processed - isGmail:",
      processedContext.isGmail
    );
    return processedContext;
  }

  // context-manager.js - Add this function after extractViaInjection

  async enhanceWithApiData(response) {
    console.log("[ContextManager] Enhancing with API data");
    console.log("[ContextManager] Metadata:", response.metadata);

    // Handle SharePoint documents
    if (
      response.metadata?.needsApiExtraction &&
      response.metadata?.isDocument
    ) {
      try {
        console.log("[ContextManager] Calling SharePoint extraction API");

        const docResponse = await chrome.runtime.sendMessage({
          type: "EXTRACT_SHAREPOINT_DOCUMENT",
          data: {
            sourceDoc: response.metadata.sourceDoc,
            fileName: response.metadata.fileName,
            fileUrl: response.metadata.documentUrl || response.url,
            siteUrl: response.url,
          },
        });

        console.log("[ContextManager] SharePoint API response:", docResponse);

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
        console.log("[ContextManager] Calling Google Docs export API");

        const exportResponse = await chrome.runtime.sendMessage({
          type: "EXTRACT_GOOGLE_DOCS",
          data: { docId: response.metadata.docId },
        });

        console.log(
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

    let contextInfo = `${context.title}`;

    if (context.wordCount > 0) {
      contextInfo += ` (${context.wordCount} words)`;
    }

    if (context.isGoogleDocs) {
      contextInfo += ` • Google Docs`;
    }

    if (context.isGmail) {
      contextInfo += ` • Gmail`;
    }

    // Show extraction method for debugging (remove in production)
    if (context.metadata?.method) {
      contextInfo += ` • ${context.metadata.method}`;
    }

    this.contextText.textContent = contextInfo;
    this.contextBar.style.display = "block";

    if (this.clearButton) {
      this.clearButton.style.display = "block";
    }
  }

  clearContext() {
    console.log("[ContextManager] Clearing context");

    this.currentContext = null;
    this.isLoaded = false;

    this.setButtonState("default");

    if (this.contextBar) {
      this.contextBar.style.display = "none";
    }

    if (this.clearButton) {
      this.clearButton.style.display = "none";
    }
  }

  getContextForMessage() {
    if (!this.isLoaded || !this.currentContext) {
      return null;
    }

    // Enhanced context with state info
    return {
      ...this.currentContext,
      sourceType: this.detectSourceType(),
      isActive: this.isSourceStillActive(),
    };
  }

  // ADD these new methods after getContextForMessage():
  detectSourceType() {
    if (this.currentContext?.isGmail) return "gmail";
    if (this.currentContext?.isGoogleDocs) return "docs";
    if (this.currentContext?.url?.includes("calendar.google.com"))
      return "calendar";
    return "web";
  }

  async isSourceStillActive() {
    // Check if the tab we extracted from is still open
    const tabs = await chrome.tabs.query({});
    return tabs.some((tab) => tab.url === this.currentContext?.url);
  }

  hasContext() {
    return this.isLoaded && this.currentContext !== null;
  }

  getContextDisplay() {
    if (!this.currentContext) {
      return "Kein Kontext verfügbar";
    }

    const { title, domain } = this.currentContext;
    return `📄 ${title || "Unbenannte Seite"} (${domain})`;
  }
}
