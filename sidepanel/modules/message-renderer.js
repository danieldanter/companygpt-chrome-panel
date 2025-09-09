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
   * Enhanced markdown rendering with better formatting
   * @param {string} text - Markdown text to render
   * @returns {string} HTML string
   */
  renderMarkdown(text) {
    if (!text) return "";

    // Don't escape HTML first - we'll handle it more carefully
    let html = text;

    // Remove quote wrapping if entire text is wrapped in quotes
    if (html.startsWith('"') && html.endsWith('"')) {
      html = html.slice(1, -1);
    }

    // Fix literal escape sequences
    html = html.replace(/\\n\\n\\n\\n/g, "\n\n");
    html = html.replace(/\\n\\n\\n/g, "\n\n");
    html = html.replace(/\\n\\n/g, "\n\n");
    html = html.replace(/\\n/g, "\n");

    // Fix escaped characters
    html = html.replace(/\\"/g, '"');
    html = html.replace(/\\\\/g, "\\");
    html = html.replace(/\\'/g, "'");
    html = html.replace(/\\&/g, "&");
    html = html.replace(/\\([^\\])/g, "$1");

    // Clean up multiple consecutive newlines
    html = html.replace(/\n\n\n+/g, "\n\n");

    // Handle code blocks FIRST (before other processing)
    const codeBlocks = [];
    html = html.replace(
      /```(\w+)?\n?([\s\S]*?)```/g,
      (match, language, code) => {
        const index = codeBlocks.length;
        const lang = language || "text";
        codeBlocks.push(
          `<pre class="code-block"><code class="language-${lang}">${this.escapeHtml(
            code.trim()
          )}</code></pre>`
        );
        return `__CODE_BLOCK_${index}__`;
      }
    );

    // Handle inline code SECOND (before other formatting)
    const inlineCodes = [];
    html = html.replace(/`([^`]+)`/g, (match, code) => {
      const index = inlineCodes.length;
      inlineCodes.push(
        `<code class="inline-code">${this.escapeHtml(code)}</code>`
      );
      return `__INLINE_CODE_${index}__`;
    });

    // Now escape remaining HTML
    html = this.escapeHtml(html);

    // Headers (must come before bold to avoid conflicts)
    html = html.replace(/^### (.*$)/gm, '<h3 class="markdown-h3">$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2 class="markdown-h2">$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1 class="markdown-h1">$1</h1>');

    // Bold and italic (enhanced patterns)
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>"); // Bold + italic
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"); // Bold
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>"); // Italic

    // Links with better pattern
    html = html.replace(
      /\[([^\]]+)\]\(([^\)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );

    // Handle different list types
    // Unordered lists (-, *, +)
    html = html.replace(/^[\-\*\+] (.+)$/gm, '<li class="markdown-li">$1</li>');

    // Numbered lists
    html = html.replace(
      /^\d+\. (.+)$/gm,
      '<li class="markdown-li numbered">$1</li>'
    );

    // Wrap consecutive list items in ul/ol tags
    html = html.replace(
      /(<li class="markdown-li"(?!.*numbered)>.*?<\/li>(?:\s*<li class="markdown-li"(?!.*numbered)>.*?<\/li>)*)/gm,
      '<ul class="markdown-ul">$1</ul>'
    );

    html = html.replace(
      /(<li class="markdown-li numbered">.*?<\/li>(?:\s*<li class="markdown-li numbered">.*?<\/li>)*)/gm,
      '<ol class="markdown-ol">$1</ol>'
    );

    // Blockquotes
    html = html.replace(
      /^&gt; (.+)$/gm,
      '<blockquote class="markdown-quote">$1</blockquote>'
    );

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr class="markdown-hr">');

    // Strikethrough
    html = html.replace(/~~(.*?)~~/g, "<del>$1</del>");

    // Task lists (checkboxes)
    html = html.replace(
      /^\- \[ \] (.+)$/gm,
      '<li class="task-item"><input type="checkbox" disabled> $1</li>'
    );
    html = html.replace(
      /^\- \[x\] (.+)$/gm,
      '<li class="task-item"><input type="checkbox" disabled checked> $1</li>'
    );

    // Highlight/mark text
    html = html.replace(/==(.*?)==/g, "<mark>$1</mark>");

    // Paragraph handling - convert double line breaks to paragraphs
    html = html.replace(/\n\s*\n/g, '</p><p class="markdown-p">');
    html = `<p class="markdown-p">${html}</p>`;

    // Clean up empty paragraphs and paragraphs that only contain HTML tags
    html = html.replace(/<p class="markdown-p">\s*<\/p>/g, "");
    html = html.replace(/<p class="markdown-p">(\s*<[^>]+>\s*)<\/p>/g, "$1");

    // Single line breaks become <br>
    html = html.replace(/\n/g, "<br>");

    // Restore code blocks and inline code
    codeBlocks.forEach((codeBlock, index) => {
      html = html.replace(`__CODE_BLOCK_${index}__`, codeBlock);
    });

    inlineCodes.forEach((inlineCode, index) => {
      html = html.replace(`__INLINE_CODE_${index}__`, inlineCode);
    });

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
