// sidepanel/modules/context-manager.js
// Unified Context Management Module

export class ContextManager {
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
      const context = await this.extractPageContext();

      if (
        !context ||
        (Object.prototype.hasOwnProperty.call(context, "success") &&
          !context.success)
      ) {
        throw new Error(context?.error || "No context available");
      }

      // Process the context (includes content from context-analyzer)
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

  /**
   * Extract context from current page
   * Handles both Google Docs and regular pages
   */
  /**
   * Extract context from current page using universal injection
   */
  async extractPageContext() {
    try {
      // Get current active tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || !tab.id) {
        throw new Error("No active tab found");
      }

      console.log("[ContextManager] Using universal extractor for:", tab.url);

      // Use universal extraction for ALL page types
      const response = await chrome.runtime.sendMessage({
        type: "INJECT_UNIVERSAL_EXTRACTOR",
        data: { tabId: tab.id },
      });

      if (response && response.success) {
        console.log(
          `[ContextManager] Universal extraction successful: ${response.length} characters (${response.pageType})`
        );

        return {
          success: true,
          title: tab.title || response.title,
          url: tab.url || response.url,
          selectedText: response.selectedText || "",
          mainContent: response.mainContent || "",
          metadata: {
            isGoogleDocs: response.pageType === "googleDocs",
            extractionMethod: response.extractionMethod,
            pageType: response.pageType,
          },
        };
      } else {
        throw new Error(response?.error || "Universal extraction failed");
      }
    } catch (error) {
      console.error("[ContextManager] Failed to extract context:", error);

      // Fallback
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return {
        success: true,
        title: tab?.title || "Unknown Page",
        url: tab?.url || "",
        selectedText: "",
        mainContent: `Unable to extract content from this page. You can still ask questions about: ${
          tab?.title || "this page"
        }`,
        metadata: { extractionMethod: "fallback" },
      };
    }
  }

  /**
   * Extract Google Docs content using injection method
   */
  async extractGoogleDocsContent(tabId, title, url) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "INJECT_GOOGLE_DOCS_EXTRACTOR",
        data: { tabId },
      });

      if (response && response.success) {
        console.log(
          `[ContextManager] Google Docs extraction: ${response.length} characters`
        );
        return {
          success: true,
          title,
          url,
          selectedText: "",
          mainContent: response.content,
          metadata: {
            isGoogleDocs: true,
            extractionMethod: "injection",
          },
        };
      } else {
        throw new Error(response?.error || "Google Docs extraction failed");
      }
    } catch (error) {
      console.error("[ContextManager] Google Docs extraction failed:", error);
      throw error;
    }
  }

  /**
   * Extract regular page content using content script
   */
  async extractRegularPageContent(tabId, title, url) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_PAGE_CONTEXT",
      });

      if (response && response.success !== false) {
        console.log("[ContextManager] Regular page extraction successful");
        return {
          success: true,
          title: title || response.title,
          url: url || response.url,
          selectedText: response.selectedText || "",
          mainContent: response.mainContent || "",
          metadata: {
            isGoogleDocs: false,
            extractionMethod: "contentScript",
          },
        };
      } else {
        throw new Error(response?.error || "Content script extraction failed");
      }
    } catch (error) {
      console.error("[ContextManager] Regular page extraction failed:", error);
      // Return basic context as fallback
      return {
        success: true,
        title,
        url,
        selectedText: "",
        mainContent: "",
        metadata: { extractionMethod: "fallback" },
      };
    }
  }

  /**
   * Process and clean extracted context
   * (Combines logic from context-analyzer.js)
   */
  processContext(rawContext) {
    console.log("[ContextManager] Processing context:", rawContext);

    // Clean and process the text content
    let textContent = "";
    if (rawContext.mainContent) {
      textContent = this.cleanText(rawContext.mainContent);

      // Truncate if too long (from context-analyzer logic)
      //textContent = this.truncateContent(textContent, 5000);
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

    // Extract domain (from context-analyzer)
    const domain = this.extractDomain(rawContext.url);

    const processedContext = {
      title: rawContext.title || "Untitled Page",
      url: rawContext.url || "",
      domain,
      selectedText,
      mainContent: textContent,
      wordCount,
      timestamp: Date.now(),
      isGoogleDocs: rawContext.metadata?.isGoogleDocs || false,
      extractionMethod: rawContext.metadata?.extractionMethod || "unknown",

      // Add summary info (from context-analyzer)
      summary: this.generateContentSummary(textContent),
    };

    console.log("[ContextManager] Context processed:", {
      title: processedContext.title,
      domain: processedContext.domain,
      wordCount: processedContext.wordCount,
      hasSelectedText: !!processedContext.selectedText,
      isGoogleDocs: processedContext.isGoogleDocs,
      method: processedContext.extractionMethod,
      contentLength: processedContext.mainContent.length,
    });

    return processedContext;
  }

  /**
   * Clean text content (improved from original)
   */
  cleanText(text) {
    if (!text) return "";

    return text
      .replace(/\s+/g, " ") // Multiple spaces to single space
      .replace(/\n\s*\n/g, "\n") // Multiple newlines to single
      .replace(/^\s+|\s+$/g, "") // Trim start and end
      .trim();
  }

  /**
   * Truncate content while preserving word boundaries
   * (From context-analyzer.js)
   */
  truncateContent(text, maxChars = 5000) {
    if (!text || text.length <= maxChars) {
      return text;
    }

    // Find last space before max chars
    const truncated = text.substring(0, maxChars);
    const lastSpace = truncated.lastIndexOf(" ");

    return lastSpace > 0
      ? truncated.substring(0, lastSpace) + "..."
      : truncated + "...";
  }

  /**
   * Extract domain from URL
   * (From context-analyzer.js)
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
   * Generate content summary
   * (From context-analyzer.js)
   */
  generateContentSummary(content) {
    if (!content) return null;

    // Basic text analysis
    const words = content.split(/\s+/).filter((w) => w.length > 0);
    const sentences = content
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 0);

    // Extract potential headers (lines that are shorter and might be titles)
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

  /**
   * Get formatted context for display
   */
  getContextDisplay() {
    if (!this.currentContext) {
      return "Kein Kontext verfügbar";
    }

    const { title, domain } = this.currentContext;
    return `📄 ${title || "Unbenannte Seite"} (${domain})`;
  }
}
