// content/content-script.js
class PageContextExtractor {
  getContext() {
    return {
      title: document.title,
      url: window.location.href,
      selectedText: window.getSelection().toString(),
      mainContent: this.extractMainContent(),
      metadata: this.getMetadata(),
    };
  }

  extractMainContent() {
    // Smart content extraction
    const article = document.querySelector('article, main, [role="main"]');
    return article?.innerText || document.body.innerText.slice(0, 5000);
  }
}

// Listen for side panel requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageContext") {
    const extractor = new PageContextExtractor();
    sendResponse(extractor.getContext());
  }
});
