// sidepanel/components/chat-message.js
class ChatMessage extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: 12px;
        }
        .message { /* styles */ }
      </style>
      <div class="message">
        <div class="content">${this.getAttribute("content")}</div>
      </div>
    `;
  }
}

customElements.define("chat-message", ChatMessage);
