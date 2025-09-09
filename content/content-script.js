console.log("[ContentScript] NEW VERSION LOADED");

class PageContextExtractor {
  async getContext() {
    const context = {
      title: document.title,
      url: window.location.href,
      selectedText: window.getSelection().toString(),
      mainContent: await this.extractMainContent(),
      metadata: { isGoogleDocs: this.isGoogleDocs() },
    };
    return context;
  }

  isGoogleDocs() {
    return window.location.href.includes("docs.google.com/document");
  }

  async extractMainContent() {
    if (!this.isGoogleDocs()) {
      return document.body?.innerText?.slice(0, 5000) || "";
    }

    try {
      const m = location.href.match(/\/document\/d\/([^/]+)/);
      if (!m) return "";

      const docId = m[1];
      const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
      const response = await fetch(exportUrl);

      if (!response.ok) return "";

      const text = await response.text();
      console.log(`[ContentScript] Extracted ${text.length} characters`);
      return text;
    } catch (error) {
      console.error("[ContentScript] Fetch failed:", error);
      return "";
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageContext") {
    (async () => {
      const extractor = new PageContextExtractor();
      const context = await extractor.getContext();
      sendResponse({ success: true, ...context });
    })();
    return true;
  }
});
