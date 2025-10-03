// sidepanel/modules/analysis-message.js

export class AnalysisMessage {
  constructor(container) {
    this.container = container;
    this.currentMessageEl = null;
    this.abortController = null;
    this.currentStep = 0;
    this.stepElements = [];
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
    // Only create container on first step
    if (step === 1) {
      this.createStepsContainer(totalSteps);
    }

    const stepEl = this.stepElements[step - 1];
    if (!stepEl) return;

    // Update step to running state
    stepEl.classList.remove("pending");
    stepEl.classList.add("running");

    // Update the icon to spinning
    const iconEl = stepEl.querySelector(".analysis-icon");
    if (iconEl) {
      iconEl.innerHTML = this.getRunningIcon();
    }

    // Animate the step appearance
    stepEl.style.opacity = "0";
    stepEl.style.transform = "translateY(-10px)";
    setTimeout(() => {
      stepEl.style.opacity = "1";
      stepEl.style.transform = "translateY(0)";
    }, 50);

    return stepEl;
  }

  createStepsContainer(totalSteps) {
    const containerEl = document.createElement("div");
    containerEl.className = "analysis-steps-container";
    containerEl.dataset.temporary = "true";

    // Create abort button at the top
    const headerEl = document.createElement("div");
    headerEl.className = "analysis-header";
    headerEl.innerHTML = `
      <span class="analysis-title">Email-Analyse läuft...</span>
      <button class="abort-button" data-action="abort">Abbrechen</button>
    `;

    containerEl.appendChild(headerEl);

    // Create all steps but keep them pending
    for (let i = 1; i <= totalSteps; i++) {
      const stepEl = document.createElement("div");
      stepEl.className = "analysis-step pending";
      stepEl.dataset.step = i;
      stepEl.innerHTML = `
        <div class="step-content">
          <span class="analysis-icon">${this.getPendingIcon()}</span>
          <span class="step-text">Schritt ${i}/${totalSteps}: Warte...</span>
        </div>
        <div class="step-result" style="display: none;"></div>
      `;

      containerEl.appendChild(stepEl);
      this.stepElements.push(stepEl);
    }

    this.container.appendChild(containerEl);
    this.currentMessageEl = containerEl;

    // Add abort handler
    const abortBtn = containerEl.querySelector(".abort-button");
    if (abortBtn) {
      abortBtn.addEventListener("click", () => this.handleAbort());
    }
  }

  /**
   * Complete a step and update its appearance
   */
  completeStep(stepNumber, text, detail) {
    const stepEl = this.stepElements[stepNumber - 1];
    if (!stepEl) return;

    // Update to completed state
    stepEl.classList.remove("running");
    stepEl.classList.add("complete");

    // Update icon to checkmark
    const iconEl = stepEl.querySelector(".analysis-icon");
    if (iconEl) {
      iconEl.innerHTML = this.getCompleteIcon();
    }

    // Update text
    const textEl = stepEl.querySelector(".step-text");
    if (textEl) {
      textEl.textContent = text;
    }

    // Add detail if provided
    if (detail) {
      const resultDiv = stepEl.querySelector(".step-result");
      if (resultDiv) {
        resultDiv.innerHTML = `<div class="step-detail">${this.escapeHtml(
          detail
        )}</div>`;
        resultDiv.style.display = "block";
      }
    }
  }

  getRunningIcon() {
    return `
      <svg class="icon-spinning" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a9 9 0 11-6.219-8.56" />
      </svg>
    `;
  }

  getPendingIcon() {
    return `<span class="icon-pending">○</span>`;
  }

  getCompleteIcon() {
    return `<span class="icon-complete">✓</span>`;
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
    const content = `
        <div class="rag-results-simple">
        <div class="rag-results-label">Gefundene Informationen (${entriesCount} Einträge):</div>
        <div class="rag-results-content-visible">
            ${this.formatRAGResults(results)}
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
