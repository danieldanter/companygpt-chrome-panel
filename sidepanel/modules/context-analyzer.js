// sidepanel/modules/context-analyzer.js

export class ContextAnalyzer {
  constructor() {
    this.currentContext = null;
    this.useContext = true;
  }

  /**
   * Extract context from the current page
   * @returns {Promise<Object>} Page context object
   */
  async getPageContext() {
    if (!this.useContext) {
      return null;
    }

    try {
      // Get current active tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || !tab.id) {
        console.warn("[ContextAnalyzer] No active tab found");
        return null;
      }

      // Send message to content script to extract context
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "getPageContext",
      });

      if (response) {
        this.currentContext = {
          ...response,
          tabId: tab.id,
          timestamp: Date.now(),
        };

        return this.currentContext;
      }
    } catch (error) {
      console.error("[ContextAnalyzer] Failed to get page context:", error);

      // Fallback to basic tab info if content script fails
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        return {
          title: tab?.title || "",
          url: tab?.url || "",
          selectedText: "",
          mainContent: "",
          error: "Content script not available",
        };
      } catch (fallbackError) {
        console.error("[ContextAnalyzer] Fallback failed:", fallbackError);
        return null;
      }
    }
  }

  /**
   * Analyze and summarize the context for the AI
   * @param {Object} context - Raw page context
   * @returns {Object} Processed context for AI
   */
  processContextForAI(context) {
    if (!context) return null;

    const processed = {
      pageInfo: {
        title: context.title,
        url: context.url,
        domain: this.extractDomain(context.url),
      },
      content: {
        selected: context.selectedText || "",
        main: this.truncateContent(context.mainContent, 3000),
        metadata: context.metadata || {},
      },
      timestamp: context.timestamp || Date.now(),
    };

    // Add content summary
    if (processed.content.main) {
      processed.content.summary = this.generateSummary(processed.content.main);
    }

    return processed;
  }

  /**
   * Extract domain from URL
   * @param {string} url - Page URL
   * @returns {string} Domain name
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
   * Truncate content to max characters while preserving word boundaries
   * @param {string} text - Text to truncate
   * @param {number} maxChars - Maximum characters
   * @returns {string} Truncated text
   */
  truncateContent(text, maxChars = 3000) {
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
   * Generate a basic summary of the content
   * @param {string} content - Page content
   * @returns {Object} Summary info
   */
  generateSummary(content) {
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

  /**
   * Check if context is still fresh (not older than 5 minutes)
   * @returns {boolean}
   */
  isContextFresh() {
    if (!this.currentContext || !this.currentContext.timestamp) {
      return false;
    }

    const age = Date.now() - this.currentContext.timestamp;
    return age < 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Clear current context
   */
  clearContext() {
    this.currentContext = null;
  }

  /**
   * Set whether to use page context
   * @param {boolean} useContext
   */
  setUseContext(useContext) {
    this.useContext = useContext;

    if (!useContext) {
      this.clearContext();
    }
  }

  /**
   * Get formatted context for display
   * @returns {string}
   */
  getContextDisplay() {
    if (!this.currentContext) {
      return "Kein Kontext verfügbar";
    }

    const { title, url } = this.currentContext;
    const domain = this.extractDomain(url);

    return `📄 ${title || "Unbenannte Seite"} (${domain})`;
  }
}
