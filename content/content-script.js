// content/content-script.js
console.log("[ContentScript] LOADED - URL:", window.location.href);
console.log("[ContentScript] LOADED - Title:", document.title);

// Test message listener immediately
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[ContentScript] Message received:", request);

  if (request.action === "getPageContext") {
    console.log("[ContentScript] Processing getPageContext request...");

    // Simple test response first
    const simpleContext = {
      title: document.title,
      url: window.location.href,
      selectedText: window.getSelection().toString(),
      mainContent: document.body.innerText.substring(0, 1000), // First 1000 chars
      testMessage: "Content script is working!",
    };

    console.log("[ContentScript] Sending simple response:", simpleContext);
    sendResponse(simpleContext);
    return true;
  }
});

class PageContextExtractor {
  getContext() {
    console.log("[ContentScript] TEST - Document URL:", document.URL);
    console.log(
      "[ContentScript] TEST - All divs found:",
      document.querySelectorAll("div").length
    );
    console.log(
      "[ContentScript] TEST - Body text length:",
      document.body.innerText.length
    );

    console.log(
      "[ContentScript] Extracting context from:",
      window.location.href
    );

    const context = {
      title: document.title,
      url: window.location.href,
      selectedText: window.getSelection().toString(),
      mainContent: this.extractMainContent(),
      metadata: this.getMetadata(),
    };

    console.log("[ContentScript] Extracted context:", {
      title: context.title,
      url: context.url,
      selectedTextLength: context.selectedText.length,
      mainContentLength: context.mainContent.length,
    });

    return context;
  }

  extractMainContent() {
    console.log("[ContentScript] Extracting main content...");

    // Check if this is Google Docs
    if (window.location.href.includes("docs.google.com")) {
      return this.extractGoogleDocsContent();
    }

    // For other sites, use general extraction
    return this.extractGeneralContent();
  }

  extractGoogleDocsContent() {
    console.log("[ContentScript] Extracting Google Docs content...");

    // Google Docs specific selectors
    const selectors = [
      ".kix-appview-editor",
      ".kix-paginateddocumentplugin",
      ".kix-paragraphrenderer",
      '[role="textbox"]',
      ".docs-texteventtarget-iframe",
    ];

    let content = "";

    // Try each selector
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        console.log(
          `[ContentScript] Found ${elements.length} elements for ${selector}`
        );

        if (elements.length > 0) {
          const texts = Array.from(elements)
            .map((el) => this.getTextFromElement(el))
            .filter((text) => text && text.length > 5);

          if (texts.length > 0) {
            content = texts.join("\n\n");
            console.log(
              `[ContentScript] Extracted ${content.length} chars with ${selector}`
            );
            break;
          }
        }
      } catch (error) {
        console.warn(`[ContentScript] Error with ${selector}:`, error);
      }
    }

    // If Google Docs specific extraction failed, try waiting and retrying
    if (!content || content.length < 10) {
      console.log(
        "[ContentScript] Google Docs content not ready, trying setTimeout..."
      );
      // Google Docs loads content dynamically, so we might need to wait
      setTimeout(() => {
        content = this.tryAlternativeGoogleDocsExtraction();
      }, 1000);
    }

    return content || this.extractGeneralContent();
  }

  tryAlternativeGoogleDocsExtraction() {
    console.log("[ContentScript] Trying alternative Google Docs extraction...");

    // Try accessing the document content through different methods
    const alternatives = [
      // Try to get all paragraph elements
      () => {
        const paragraphs = document.querySelectorAll(
          '[role="listitem"], .kix-paragraphrenderer'
        );
        return Array.from(paragraphs)
          .map((p) => p.innerText || p.textContent)
          .join("\n");
      },

      // Try to get the main document body
      () => {
        const body = document.querySelector(".kix-appview-editor-container");
        return body ? body.innerText || body.textContent : "";
      },

      // Try getting any contenteditable elements
      () => {
        const editables = document.querySelectorAll('[contenteditable="true"]');
        return Array.from(editables)
          .map((el) => el.innerText || el.textContent)
          .join("\n");
      },
    ];

    for (const attempt of alternatives) {
      try {
        const result = attempt();
        if (result && result.length > 20) {
          console.log(
            "[ContentScript] Alternative extraction successful:",
            result.length,
            "chars"
          );
          return result;
        }
      } catch (error) {
        console.warn("[ContentScript] Alternative extraction failed:", error);
      }
    }

    return "";
  }

  extractGeneralContent() {
    console.log("[ContentScript] Using general content extraction...");

    // Smart content extraction for non-Google Docs sites
    const candidates = [
      document.querySelector("article"),
      document.querySelector("main"),
      document.querySelector('[role="main"]'),
      document.querySelector(".content"),
      document.querySelector("#content"),
      document.body,
    ].filter(Boolean);

    for (const element of candidates) {
      const text = this.getTextFromElement(element);
      if (text && text.length > 100) {
        return text.slice(0, 5000); // Limit to 5000 chars
      }
    }

    return document.body?.innerText?.slice(0, 5000) || "";
  }

  getTextFromElement(element) {
    if (!element) return "";

    try {
      // Prefer innerText as it respects visibility and formatting
      if (element.innerText) {
        return element.innerText.trim();
      }

      // Fallback to textContent
      if (element.textContent) {
        return element.textContent.trim();
      }

      return "";
    } catch (error) {
      console.warn("[ContentScript] Error extracting text:", error);
      return "";
    }
  }

  getMetadata() {
    // Extract page metadata
    const meta = {};

    try {
      // Get meta tags
      const metaTags = document.querySelectorAll("meta");
      metaTags.forEach((tag) => {
        const name = tag.getAttribute("name") || tag.getAttribute("property");
        const content = tag.getAttribute("content");
        if (name && content) {
          meta[name] = content;
        }
      });
    } catch (error) {
      console.warn("[ContentScript] Error extracting metadata:", error);
    }

    return meta;
  }
}

// Listen for side panel requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[ContentScript] Received message:", request);

  if (request.action === "getPageContext") {
    try {
      const extractor = new PageContextExtractor();
      const context = extractor.getContext();
      console.log("[ContentScript] Sending context response:", context);
      sendResponse(context);
    } catch (error) {
      console.error("[ContentScript] Error getting context:", error);
      sendResponse({
        title: document.title,
        url: window.location.href,
        selectedText: "",
        mainContent: "",
        error: error.message,
      });
    }
  }

  return true; // Keep the message channel open
});
