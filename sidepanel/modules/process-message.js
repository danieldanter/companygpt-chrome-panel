// sidepanel/modules/process-message.js

export class ProcessMessage {
  constructor() {
    this.processMessages = new Map(); // Track all process messages
  }

  /**
   * Create a process message element
   */
  createProcessMessage(processData) {
    const messageEl = document.createElement("div");
    messageEl.className = "message process-message";
    messageEl.dataset.messageId = processData.id;
    messageEl.dataset.collapsed = "true";

    const steps = processData.steps || [];
    const folderName = processData.folderName || "Datenspeicher";

    // ADD THESE TWO LINES HERE:
    const entriesCount = processData.entriesCount || 0;
    const entriesText = entriesCount === 1 ? "Eintrag" : "Einträge";

    messageEl.innerHTML = `
        <div class="process-content">
        <div class="process-header" data-action="toggle">
            <svg class="process-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <span class="process-title">Datenspeicher-Analyse mit "${folderName}" durchgeführt</span>
            <!-- UPDATE THIS LINE BELOW: -->
            <span class="process-meta">${entriesCount} ${entriesText} • ${
      steps.length
    } Schritte</span>
            <span class="process-toggle">▼</span>
        </div>
        <div class="process-details" style="display: none;">
            ${this.renderSteps(steps)}
        </div>
        </div>
    `;

    // Add toggle functionality
    const header = messageEl.querySelector(".process-header");
    header.addEventListener("click", () => this.toggleProcess(messageEl));

    return messageEl;
  }

  renderSteps(steps) {
    return steps
      .map(
        (step, index) => `
        <div class="process-step">
            <span class="step-icon">✓</span>
            <span class="step-label">Schritt ${index + 1}:</span>
            <span class="step-text">${step.text}</span>
            ${
              step.detail
                ? `<div class="step-detail">${this.escapeHtml(
                    step.detail
                  )}</div>`
                : ""
            }
        </div>
        `
      )
      .join("");
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Render the steps HTML
   */
  renderSteps(steps) {
    return steps
      .map(
        (step, index) => `
        <div class="process-step">
            <span class="step-icon">✓</span>
            <span class="step-label">Schritt ${index + 1}:</span>
            <span class="step-text">${step.text}</span>
            ${
              step.detail
                ? `
            <div class="step-detail">
                ${
                  index === 0
                    ? `Suchanfrage: "${this.escapeHtml(step.detail)}"`
                    : index === 1
                    ? `<div class="rag-content">${this.escapeHtml(
                        step.detail
                      )}</div>`
                    : this.escapeHtml(step.detail)
                }
            </div>
            `
                : ""
            }
        </div>
        `
      )
      .join("");
  }

  /**
   * Toggle expand/collapse
   */
  toggleProcess(messageEl) {
    const isCollapsed = messageEl.dataset.collapsed === "true";
    const details = messageEl.querySelector(".process-details");
    const toggle = messageEl.querySelector(".process-toggle");

    if (isCollapsed) {
      details.style.display = "block";
      toggle.textContent = "▲";
      messageEl.dataset.collapsed = "false";
    } else {
      details.style.display = "none";
      toggle.textContent = "▼";
      messageEl.dataset.collapsed = "true";
    }
  }

  /**
   * Add a process message to chat
   */
  addToChat(container, processData) {
    const messageEl = this.createProcessMessage(processData);
    container.appendChild(messageEl);
    this.processMessages.set(processData.id, processData);
    return messageEl;
  }
}
