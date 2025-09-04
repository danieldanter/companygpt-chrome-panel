// sidepanel/modules/chat-controller.js
export class ChatController {
  constructor() {
    this.messages = [];
    this.currentContext = null;
    this.ws = null; // WebSocket for streaming
  }

  async initialize() {
    // Reuse auth service
    await AuthService.initialize();

    // Load chat history
    this.messages = await this.loadHistory();

    // Connect WebSocket for streaming
    await this.connectWebSocket();
  }

  async sendMessage(text) {
    // Get page context from content script
    const context = await this.getPageContext();

    // Send via API (reuse api-service patterns)
    const response = await APIService.chat.send({
      message: text,
      context: context,
      sessionId: this.sessionId,
    });

    return response;
  }
}
