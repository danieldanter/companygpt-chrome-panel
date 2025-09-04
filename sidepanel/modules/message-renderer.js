// sidepanel/modules/message-renderer.js

export class MessageRenderer {
  constructor() {
    this.container = null;
    this.typingIndicators = new Map();
  }

  /**
   * Initialize the renderer with a container element
   * @param {HTMLElement} container - Messages container element
   */
  init(container) {
    this.container = container;
  }

  /**
   * Render a message to the chat
   * @param {Object} message - Message object
   * @param {string} message.content - Message content
   * @param {string} message.role - 'user', 'assistant', 'system', or 'error'
   * @param {Object} message.metadata - Optional metadata
   * @returns {HTMLElement} The created message element
   */
  renderMessage(message) {
    if (!this.container) {
      console.error("[MessageRenderer] Container not initialized");
      return null;
    }

    const messageEl = document.createElement("div");
    messageEl.className = `message ${message.role}`;
    messageEl.dataset.messageId = message.id || Date.now().toString();

    // Handle different content types
    if (message.role === "assistant" && message.isStreaming) {
      messageEl.innerHTML = this.renderStreamingMessage(message.content);
    } else if (message.metadata?.isMarkdown) {
      messageEl.innerHTML = this.renderMarkdown(message.content);
    } else if (message.metadata?.isPermissionRequest) {
      messageEl.innerHTML = this.renderPermissionRequest(message);
    } else {
      messageEl.textContent = message.content;
    }

    // Add timestamp
    if (message.timestamp) {
      const timeEl = document.createElement("div");
      timeEl.className = "message-time";
      timeEl.textContent = this.formatTimestamp(message.timestamp);
      messageEl.appendChild(timeEl);
    }

    this.container.appendChild(messageEl);
    this.scrollToBottom();

    return messageEl;
  }

  /**
   * Update an existing message (for streaming responses)
   * @param {string} messageId - Message ID to update
   * @param {string} content - New content
   */
  updateMessage(messageId, content) {
    const messageEl = this.container?.querySelector(
      `[data-message-id="${messageId}"]`
    );

    if (messageEl) {
      // Preserve the time element if it exists
      const timeEl = messageEl.querySelector(".message-time");
      messageEl.innerHTML = this.renderMarkdown(content);

      if (timeEl) {
        messageEl.appendChild(timeEl);
      }

      this.scrollToBottom();
    }
  }

  /**
   * Render a streaming message with a cursor
   * @param {string} content - Current content
   * @returns {string} HTML string
   */
  renderStreamingMessage(content) {
    return `${this.renderMarkdown(
      content
    )}<span class="streaming-cursor">▊</span>`;
  }

  /**
   * Basic markdown rendering
   * @param {string} text - Markdown text
   * @returns {string} HTML string
   */
  renderMarkdown(text) {
    if (!text) return "";

    // Escape HTML first
    let html = this.escapeHtml(text);

    // Convert markdown syntax
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Links
    html = html.replace(
      /\[([^\]]+)\]\(([^\)]+)\)/g,
      '<a href="$2" target="_blank">$1</a>'
    );

    // Line breaks
    html = html.replace(/\n/g, "<br>");

    // Lists
    html = html.replace(/^\* (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");

    return html;
  }

  /**
   * Render permission request UI
   * @param {Object} message - Message with permission data
   * @returns {string} HTML string
   */
  renderPermissionRequest(message) {
    const {
      title,
      description,
      allowText = "Erlauben",
      denyText = "Ablehnen",
    } = message.metadata || {};

    return `
      <div class="permission-request">
        <div class="permission-title">${
          title || "Berechtigung erforderlich"
        }</div>
        <div class="permission-text">
          ${description || "Diese Aktion benötigt deine Zustimmung."}
        </div>
        <div class="permission-buttons">
          <button class="btn-allow" data-action="allow">${allowText}</button>
          <button class="btn-deny" data-action="deny">${denyText}</button>
        </div>
      </div>
    `;
  }

  /**
   * Show typing indicator
   * @param {string} id - Unique ID for this indicator
   * @returns {string} Indicator ID
   */
  showTypingIndicator(id = null) {
    const indicatorId = id || `typing-${Date.now()}`;

    const typingEl = document.createElement("div");
    typingEl.className = "typing-indicator";
    typingEl.id = indicatorId;
    typingEl.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;

    this.container?.appendChild(typingEl);
    this.typingIndicators.set(indicatorId, typingEl);
    this.scrollToBottom();

    return indicatorId;
  }

  /**
   * Hide typing indicator
   * @param {string} indicatorId - Indicator ID to remove
   */
  hideTypingIndicator(indicatorId) {
    const indicator = this.typingIndicators.get(indicatorId);

    if (indicator) {
      indicator.remove();
      this.typingIndicators.delete(indicatorId);
    }
  }

  /**
   * Clear all messages
   */
  clearMessages() {
    if (this.container) {
      this.container.innerHTML = "";
    }
    this.typingIndicators.clear();
  }

  /**
   * Scroll to bottom of messages
   */
  scrollToBottom() {
    if (this.container) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  /**
   * Format timestamp for display
   * @param {number|Date} timestamp - Timestamp to format
   * @returns {string} Formatted time string
   */
  formatTimestamp(timestamp) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const now = new Date();

    // If today, show time only
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    // Otherwise show date and time
    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Add CSS for typing indicator animation
   */
  addTypingStyles() {
    if (document.getElementById("typing-styles")) return;

    const style = document.createElement("style");
    style.id = "typing-styles";
    style.textContent = `
      .typing-indicator {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 12px 14px;
        margin-top: 12px;
      }
      
      .typing-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--text-muted);
        animation: typing 1.4s infinite;
      }
      
      .typing-dot:nth-child(2) {
        animation-delay: 0.2s;
      }
      
      .typing-dot:nth-child(3) {
        animation-delay: 0.4s;
      }
      
      @keyframes typing {
        0%, 60%, 100% {
          opacity: 0.3;
          transform: translateY(0);
        }
        30% {
          opacity: 1;
          transform: translateY(-10px);
        }
      }
      
      .streaming-cursor {
        animation: blink 1s infinite;
        color: var(--blue-500);
      }
      
      @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0; }
      }
      
      .message-time {
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 4px;
      }
    `;

    document.head.appendChild(style);
  }
}
