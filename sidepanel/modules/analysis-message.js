// sidepanel/modules/analysis-message.js

export class AnalysisMessage {
  constructor(container) {
    this.container = container;
    this.store = window.AppStore;
    this.currentMessageEl = null;
    this.abortController = null;
  }

  /**
   * Create an analysis message element
   */
  createAnalysisMessage(step, totalSteps, text, status = "running") {
    const messageEl = document.createElement("div");
    messageEl.className = `message analysis-message ${status}`;
    messageEl.dataset.step = step;
    messageEl.dataset.temporary = "true"; // Mark for removal later

    const iconSvg = this.getStepIcon();

    messageEl.innerHTML = `
      <div class="analysis-content">
        <div class="analysis-header">
          ${iconSvg}
          <span class="analysis-text">${text}</span>
          <span class="step-indicator">Schritt ${step}/${totalSteps}</span>
          ${
            status === "running"
              ? '<button class="abort-button" data-action="abort">Abbrechen</button>'
              : ""
          }
        </div>
        <div class="analysis-result" style="display: none;"></div>
      </div>
    `;

    // Add abort handler
    const abortBtn = messageEl.querySelector(".abort-button");
    if (abortBtn) {
      abortBtn.addEventListener("click", () => this.handleAbort());
    }

    return messageEl;
  }

  /**
   * Get consistent icon for all analysis steps
   */
  getStepIcon() {
    // Use the same data/chart icon style as other icons
    return `
      <svg class="analysis-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    `;
  }

  /**
   * Show analysis step
   */
  showStep(step, totalSteps, text) {
    this.currentMessageEl = this.createAnalysisMessage(
      step,
      totalSteps,
      text,
      "running"
    );
    this.container.appendChild(this.currentMessageEl);
    this.scrollToBottom();
    return this.currentMessageEl;
  }

  /**
   * Update step with result
   */
  updateStepResult(messageEl, content, status = "complete") {
    if (!messageEl) return;

    // Update status
    messageEl.classList.remove("running", "error", "complete");
    messageEl.classList.add(status);

    // Remove abort button
    const abortBtn = messageEl.querySelector(".abort-button");
    if (abortBtn) abortBtn.remove();

    // Add result content
    const resultDiv = messageEl.querySelector(".analysis-result");
    if (resultDiv) {
      resultDiv.innerHTML = content;
      resultDiv.style.display = "block";
    }

    this.scrollToBottom();
  }

  /**
   * Show extracted query in a bubble
   */
  showQueryBubble(messageEl, query) {
    const content = `
      <div class="query-bubble">
        <div class="query-label">Suchanfrage:</div>
        <div class="query-text">${this.escapeHtml(query)}</div>
      </div>
    `;
    this.updateStepResult(messageEl, content, "complete");
  }

  /**
   * Show RAG results in collapsible
   */
  showRAGResults(messageEl, results, entriesCount = 0) {
    const isExpanded = this.store.get("chat.ragResultsExpanded");
    const content = `
      <div class="rag-results ${isExpanded ? "expanded" : ""}">
        <div class="rag-results-header" onclick="window.companyGPTChat.toggleRAGResults()">
          <span class="rag-arrow">${isExpanded ? "▼" : "▶"}</span>
          <span>Gefundene Informationen (${entriesCount} Einträge)</span>
        </div>
        <div class="rag-results-content" style="display: ${
          isExpanded ? "block" : "none"
        };">
          <div class="rag-results-text">${this.formatRAGResults(results)}</div>
        </div>
      </div>
    `;
    this.updateStepResult(messageEl, content, "complete");
  }

  /**
   * Format RAG results for display
   */
  formatRAGResults(results) {
    if (!results) return "<em>Keine Ergebnisse</em>";

    // If results is a string
    if (typeof results === "string") {
      return `<pre>${this.escapeHtml(results)}</pre>`;
    }

    // If results is an array or object, format nicely
    if (Array.isArray(results)) {
      return results
        .map(
          (item, idx) => `
        <div class="rag-result-item">
          <strong>Eintrag ${idx + 1}:</strong>
          <div>${this.escapeHtml(item.content || item)}</div>
        </div>
      `
        )
        .join("");
    }

    return `<pre>${this.escapeHtml(JSON.stringify(results, null, 2))}</pre>`;
  }

  /**
   * Handle abort
   */
  handleAbort() {
    console.log("[AnalysisMessage] Abort requested");

    // Set abort flag in store
    this.store.set("chat.multiStepProcess.active", false);

    // Trigger abort in ChatController
    if (this.abortController) {
      this.abortController.abort();
    }

    // Clean up UI
    this.cleanup();

    // Show abort message
    const abortMsg = document.createElement("div");
    abortMsg.className = "message system";
    abortMsg.innerHTML = "❌ Vorgang abgebrochen";
    this.container.appendChild(abortMsg);
    this.scrollToBottom();
  }

  /**
   * Clean up analysis messages
   */
  cleanup() {
    // Remove all temporary analysis messages
    const tempMessages = this.container.querySelectorAll(
      '[data-temporary="true"]'
    );
    tempMessages.forEach((msg) => msg.remove());

    // Reset store
    this.store.set("chat.multiStepProcess", {
      active: false,
      type: null,
      currentStep: 0,
      totalSteps: 3,
      canAbort: true,
      abortController: null,
      steps: [],
    });
    this.store.set("chat.extractedQuery", null);
    this.store.set("chat.ragResults", null);
  }

  /**
   * Remove analysis messages after completion
   */
  removeAnalysisMessages() {
    // Remove all analysis messages, keeping only final result
    setTimeout(() => {
      const tempMessages = this.container.querySelectorAll(
        '[data-temporary="true"]'
      );
      tempMessages.forEach((msg) => {
        msg.style.transition = "opacity 0.3s ease";
        msg.style.opacity = "0";
        setTimeout(() => msg.remove(), 300);
      });
    }, 500); // Short delay before removing
  }

  scrollToBottom() {
    if (this.container) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
