// shared/chat-store.js (adapted from simple-store.js)
class ChatStore {
  constructor() {
    this.state = {
      messages: [],
      currentChat: null,
      isStreaming: false,
      context: {
        pageTitle: "",
        pageUrl: "",
        selectedText: "",
        pageContent: "",
      },
      auth: {
        isAuthenticated: false,
        domain: null,
      },
    };

    this.subscribers = new Map();
  }

  // Reuse dispatch pattern from your store
  dispatch(action, payload) {
    switch (action) {
      case "ADD_MESSAGE":
        this.state.messages.push(payload);
        break;
      case "START_STREAMING":
        this.state.isStreaming = true;
        break;
      // etc...
    }
    this.notifySubscribers(action, this.state);
  }
}
