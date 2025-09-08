// sidepanel/app.js
import { ChatController } from "./modules/chat-controller.js";
import { MessageRenderer } from "./modules/message-renderer.js";
import { ContextAnalyzer } from "./modules/context-analyzer.js";

// Add this to your app.js file - Context Management System

class ContextManager {
  constructor(app) {
    this.app = app;
    this.currentContext = null;
    this.isLoaded = false;
    this.lastUrl = null;

    // UI elements
    this.loadButton = null;
    this.contextBar = null;
    this.contextText = null;
    this.clearButton = null;

    this.init();
  }

  init() {
    console.log("[ContextManager] Initializing...");

    // Get UI elements
    this.loadButton = document.getElementById("load-context-btn");
    this.contextBar = document.getElementById("context-bar");
    this.contextText = document.getElementById("context-text");
    this.clearButton = document.getElementById("clear-context");

    // Setup event listeners
    this.setupEventListeners();

    // Monitor page changes
    this.monitorPageChanges();
  }

  setupEventListeners() {
    // Load context button
    this.loadButton?.addEventListener("click", () => {
      this.loadPageContext();
    });

    // Clear context button
    this.clearButton?.addEventListener("click", () => {
      this.clearContext();
    });
  }

  async monitorPageChanges() {
    // Check for URL changes every 2 seconds
    setInterval(async () => {
      const currentUrl = await this.getCurrentUrl();

      if (this.lastUrl && currentUrl !== this.lastUrl) {
        console.log("[ContextManager] Page changed:", currentUrl);
        this.onPageChange(currentUrl);
      }

      this.lastUrl = currentUrl;
    }, 2000);
  }

  async getCurrentUrl() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab?.url || "";
    } catch {
      return "";
    }
  }

  onPageChange(newUrl) {
    // Reset context when page changes
    this.clearContext();

    // Show subtle notification that context is available
    this.showContextAvailable();
  }

  showContextAvailable() {
    // Add a subtle pulse to the load button
    this.loadButton?.classList.add("context-available");
    setTimeout(() => {
      this.loadButton?.classList.remove("context-available");
    }, 3000);
  }

  async loadPageContext() {
    if (!this.loadButton) return;

    console.log("[ContextManager] Loading page context...");

    // Set loading state
    this.setButtonState("loading");

    try {
      // Get page context using existing method
      const context = await this.app.getPageContext();

      if (!context) {
        throw new Error("No context available");
      }

      // Process and clean the context
      const processedContext = this.processContext(context);

      // Store context
      this.currentContext = processedContext;
      this.isLoaded = true;

      // Update UI
      this.setButtonState("loaded");
      this.showContextBar(processedContext);

      console.log("[ContextManager] Context loaded:", processedContext);
    } catch (error) {
      console.error("[ContextManager] Failed to load context:", error);
      this.setButtonState("error");

      // Reset after 3 seconds
      setTimeout(() => {
        this.setButtonState("default");
      }, 3000);
    }
  }

  async processContext(rawContext) {
    console.log("[ContextManager] === PROCESSING CONTEXT START ===");
    console.log("[ContextManager] Processing raw context:", rawContext);

    let textContent = "";

    if (rawContext.url && rawContext.url.includes("docs.google.com")) {
      console.log(
        "[ContextManager] Google Docs detected, using enhanced extraction"
      );
      textContent = await this.extractGoogleDocsContent(rawContext); // NOW PROPERLY AWAITED
    } else {
      console.log(
        "[ContextManager] Non-Google Docs site, using standard extraction"
      );
      if (rawContext.mainContent) {
        textContent = this.cleanText(rawContext.mainContent);
      }
    }

    // Get selected text if available
    let selectedText = "";
    if (rawContext.selectedText) {
      selectedText = this.cleanText(rawContext.selectedText);
      console.log(
        "[ContextManager] Selected text found:",
        selectedText.length,
        "chars"
      );
    }

    // If no content extracted, try fallback methods
    if (!textContent && !selectedText) {
      console.log("[ContextManager] No content extracted, trying fallback");
      textContent = this.fallbackExtraction();
    }

    // Calculate word count
    const wordCount = textContent
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    console.log("[ContextManager] === FINAL EXTRACTION RESULTS ===");
    console.log("[ContextManager] Word count:", wordCount);
    console.log("[ContextManager] Text length:", textContent.length);
    console.log("[ContextManager] Has selected text:", !!selectedText);
    console.log(
      "[ContextManager] Content preview:",
      textContent.substring(0, 150) + "..."
    );
    console.log("[ContextManager] === PROCESSING CONTEXT END ===");

    return {
      title: rawContext.title || "Untitled Page",
      url: rawContext.url || "",
      selectedText,
      mainContent: textContent,
      wordCount,
      timestamp: Date.now(),
    };
  }

  // Add this new method to extract Google Docs content
  async extractGoogleDocsContent(rawContext) {
    console.log("[ContextManager] === GOOGLE DOCS EXTRACTION START ===");
    console.log("[ContextManager] URL:", rawContext.url);
    console.log("[ContextManager] Title:", rawContext.title);

    let extractedText = "";

    // PHASE 1: Try DOM extraction first (fast method)
    console.log("[ContextManager] PHASE 1: Attempting DOM extraction...");
    extractedText = this.tryDOMExtraction();

    if (extractedText && extractedText.length > 50) {
      console.log(
        `[ContextManager] ✅ DOM extraction successful: ${extractedText.length} chars`
      );
      console.log(
        "[ContextManager] DOM content preview:",
        extractedText.substring(0, 100) + "..."
      );
      return this.cleanText(extractedText);
    }

    console.log(
      "[ContextManager] ❌ DOM extraction failed or insufficient content"
    );
    console.log(`[ContextManager] DOM result length: ${extractedText.length}`);

    // PHASE 2: Try Select All method (fallback) - NOW PROPERLY ASYNC
    console.log(
      "[ContextManager] PHASE 2: Attempting Select All extraction..."
    );
    try {
      extractedText = await this.trySelectAllExtraction();

      if (extractedText && extractedText.length > 50) {
        console.log(
          `[ContextManager] ✅ Select All extraction successful: ${extractedText.length} chars`
        );
        console.log(
          "[ContextManager] Select All content preview:",
          extractedText.substring(0, 100) + "..."
        );
        return this.cleanText(extractedText);
      }

      console.log("[ContextManager] ❌ Select All extraction also failed");
      console.log(
        `[ContextManager] Select All result length: ${
          extractedText ? extractedText.length : 0
        }`
      );
    } catch (error) {
      console.error("[ContextManager] Select All extraction error:", error);
    }

    // PHASE 3: Final fallback to raw content
    console.log("[ContextManager] PHASE 3: Using raw content fallback...");
    if (rawContext.mainContent && rawContext.mainContent.length > 10) {
      console.log(
        `[ContextManager] ✅ Using raw mainContent: ${rawContext.mainContent.length} chars`
      );
      return this.cleanText(rawContext.mainContent);
    }

    console.log("[ContextManager] ❌ All extraction methods failed");
    console.log("[ContextManager] === GOOGLE DOCS EXTRACTION END ===");
    return "";
  }

  // Add this new method for DOM extraction
  tryDOMExtraction() {
    console.log("[ContextManager] Starting DOM extraction...");

    const googleDocsSelectors = [
      ".kix-appview-editor",
      ".kix-paginateddocumentplugin",
      ".kix-paragraphrenderer",
      ".docs-texteventtarget-iframe",
      '[role="textbox"]',
      ".kix-wordhtmlgenerator-word-node",
      // Additional selectors to try
      ".kix-canvas-tile-content",
      ".kix-canvas-tile",
      '[contenteditable="true"]',
      ".docs-editor-container",
    ];

    for (const selector of googleDocsSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        console.log(
          `[ContextManager] Selector "${selector}": found ${elements.length} elements`
        );

        if (elements.length > 0) {
          const texts = Array.from(elements)
            .map((el) => {
              const text = this.extractTextFromElement(el);
              console.log(
                `[ContextManager] Element text length: ${text.length}`
              );
              return text;
            })
            .filter((text) => text && text.length > 10);

          if (texts.length > 0) {
            const combined = texts.join("\n\n");
            console.log(
              `[ContextManager] Combined DOM text: ${combined.length} chars`
            );
            if (combined.length > 50) {
              return combined;
            }
          }
        }
      } catch (error) {
        console.warn(
          `[ContextManager] DOM extraction error with ${selector}:`,
          error
        );
      }
    }

    console.log("[ContextManager] DOM extraction completed with no results");
    return "";
  }

  // Add this new method for Select All extraction
  // Replace the trySelectAllExtraction method in your ContextManager class

  trySelectAllExtraction() {
    console.log("[ContextManager] Starting Select All extraction...");

    // ADD THESE DEBUG LINES HERE:
    console.log("[Debug] Document URL:", document.URL);
    console.log("[Debug] Document title:", document.title);
    console.log("[Debug] Window location:", window.location.href);

    return new Promise((resolve) => {
      try {
        // Store current selection to restore later
        const originalSelection = window.getSelection().toString();
        console.log(
          "[ContextManager] Stored original selection:",
          originalSelection.length,
          "chars"
        );

        // METHOD 1: Try programmatic Ctrl+A simulation first
        console.log("[ContextManager] METHOD 1: Trying Ctrl+A simulation...");

        // Clear any existing selection
        window.getSelection().removeAllRanges();

        // Try to trigger Ctrl+A programmatically
        const ctrlAEvent = new KeyboardEvent("keydown", {
          key: "a",
          code: "KeyA",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });

        // Dispatch to document or active element
        const activeElement = document.activeElement || document.body;
        activeElement.dispatchEvent(ctrlAEvent);

        // Wait for the simulated Ctrl+A to take effect
        setTimeout(() => {
          let selectedText = window.getSelection().toString();
          console.log(
            `[ContextManager] METHOD 1 result: ${selectedText.length} chars`
          );

          if (selectedText && selectedText.length > 100) {
            console.log(
              "[ContextManager] METHOD 1 successful - Ctrl+A simulation worked"
            );
            console.log(
              "[ContextManager] Selected text preview:",
              selectedText.substring(0, 200) + "..."
            );

            // Restore original selection
            window.getSelection().removeAllRanges();
            resolve(selectedText);
            return;
          }

          // METHOD 2: Try document.execCommand('selectAll')
          console.log(
            "[ContextManager] METHOD 2: Trying execCommand selectAll..."
          );

          try {
            window.getSelection().removeAllRanges();
            document.execCommand("selectAll");

            setTimeout(() => {
              selectedText = window.getSelection().toString();
              console.log(
                `[ContextManager] METHOD 2 result: ${selectedText.length} chars`
              );

              if (selectedText && selectedText.length > 100) {
                console.log(
                  "[ContextManager] METHOD 2 successful - execCommand worked"
                );
                console.log(
                  "[ContextManager] Selected text preview:",
                  selectedText.substring(0, 200) + "..."
                );

                // Restore original selection
                window.getSelection().removeAllRanges();
                resolve(selectedText);
                return;
              }

              // METHOD 3: Try range selection on document.body
              console.log(
                "[ContextManager] METHOD 3: Trying range selection on document.body..."
              );

              try {
                window.getSelection().removeAllRanges();
                const range = document.createRange();
                range.selectNodeContents(document.body);
                window.getSelection().addRange(range);

                setTimeout(() => {
                  selectedText = window.getSelection().toString();
                  console.log(
                    `[ContextManager] METHOD 3 result: ${selectedText.length} chars`
                  );

                  if (selectedText && selectedText.length > 50) {
                    console.log(
                      "[ContextManager] METHOD 3 successful - range selection worked"
                    );
                    console.log(
                      "[ContextManager] Selected text preview:",
                      selectedText.substring(0, 200) + "..."
                    );

                    // Clean up selection and resolve
                    window.getSelection().removeAllRanges();
                    resolve(selectedText);
                    return;
                  }

                  // METHOD 4: Try focusing and then selecting
                  console.log(
                    "[ContextManager] METHOD 4: Trying focus + range selection..."
                  );

                  // Try to focus the document
                  if (document.body.focus) {
                    document.body.focus();
                  }

                  // Try to find any focusable element and focus it
                  const focusableElements = document.querySelectorAll(
                    '[contenteditable="true"], input, textarea, [tabindex]'
                  );
                  if (focusableElements.length > 0) {
                    console.log(
                      `[ContextManager] Found ${focusableElements.length} focusable elements`
                    );
                    focusableElements[0].focus();
                  }

                  setTimeout(() => {
                    // Try Ctrl+A again after focusing
                    const ctrlAEvent2 = new KeyboardEvent("keydown", {
                      key: "a",
                      code: "KeyA",
                      ctrlKey: true,
                      bubbles: true,
                      cancelable: true,
                    });

                    (document.activeElement || document.body).dispatchEvent(
                      ctrlAEvent2
                    );

                    setTimeout(() => {
                      selectedText = window.getSelection().toString();
                      console.log(
                        `[ContextManager] METHOD 4 result: ${selectedText.length} chars`
                      );

                      if (selectedText && selectedText.length > 50) {
                        console.log(
                          "[ContextManager] METHOD 4 successful - focus + Ctrl+A worked"
                        );
                        console.log(
                          "[ContextManager] Selected text preview:",
                          selectedText.substring(0, 200) + "..."
                        );
                      } else {
                        console.log(
                          "[ContextManager] All methods failed - no text selected"
                        );
                      }

                      // Restore original selection and resolve
                      window.getSelection().removeAllRanges();
                      resolve(selectedText || "");
                    }, 300);
                  }, 300);
                }, 300);
              } catch (rangeError) {
                console.error("[ContextManager] METHOD 3 error:", rangeError);
                resolve("");
              }
            }, 300);
          } catch (execError) {
            console.error("[ContextManager] METHOD 2 error:", execError);
            resolve("");
          }
        }, 500); // Increased initial timeout for Google Docs
      } catch (error) {
        console.error("[ContextManager] Select All extraction error:", error);
        resolve("");
      }
    });
  }

  // Add this helper method to find the best content element
  // Replace the findBestContentElement method in your ContextManager class

  findBestContentElement() {
    console.log(
      "[ContextManager] Finding best content element for Google Docs..."
    );

    // Google Docs specific selectors in order of preference
    const googleDocsSelectors = [
      // Primary Google Docs editor containers
      ".kix-appview-editor-container",
      ".kix-appview-editor",
      ".docs-editor-container",
      ".docs-editor",

      // Document content areas
      ".kix-paginateddocumentplugin",
      ".kix-canvas-tile-content",
      ".kix-canvas-tile",

      // Text content containers
      ".kix-paragraphrenderer-container",
      ".kix-paragraphrenderer",
      ".kix-lineview-text-block",

      // Editable areas
      '[role="textbox"][aria-label*="document"]',
      '[role="textbox"][aria-label*="Document"]',
      '[contenteditable="true"][role="textbox"]',

      // Canvas and rendering layers
      ".kix-canvas-tile-selection-layer",
      ".kix-canvas-tile-layer",
      ".kix-canvas-tile-content-layer",

      // Document structure
      ".kix-document-container",
      ".kix-document",

      // Fallback to any Google Docs element with substantial content
      '[class*="kix-"][class*="content"]',
      '[class*="kix-"][class*="text"]',
      '[class*="docs-"][class*="editor"]',
    ];

    // Try each Google Docs specific selector
    for (let i = 0; i < googleDocsSelectors.length; i++) {
      const selector = googleDocsSelectors[i];

      try {
        const elements = document.querySelectorAll(selector);
        console.log(
          `[ContextManager] Selector "${selector}": found ${elements.length} elements`
        );

        if (elements.length > 0) {
          // Try each element to find one with meaningful content
          for (let j = 0; j < elements.length; j++) {
            const element = elements[j];

            const elementInfo = {
              tagName: element.tagName,
              className: element.className,
              id: element.id,
              ariaLabel: element.getAttribute("aria-label"),
              role: element.getAttribute("role"),
              textLength: (element.innerText || element.textContent || "")
                .length,
              hasChildren: element.children.length,
              offsetWidth: element.offsetWidth,
              offsetHeight: element.offsetHeight,
            };

            console.log(
              `[ContextManager] Element ${j + 1} details:`,
              elementInfo
            );

            // Check if this element looks like actual content
            if (this.isGoodGoogleDocsElement(element, elementInfo)) {
              console.log(
                `[ContextManager] ✅ Selected element with selector: ${selector}`
              );
              return element;
            }
          }
        }
      } catch (error) {
        console.warn(
          `[ContextManager] Error checking selector ${selector}:`,
          error
        );
      }
    }

    // If no Google Docs specific elements found, try alternative strategies
    console.log(
      "[ContextManager] No Google Docs elements found, trying alternative strategies..."
    );

    // Strategy 2: Look for iframes (Google Docs sometimes uses iframes)
    const iframes = document.querySelectorAll("iframe");
    console.log(`[ContextManager] Found ${iframes.length} iframes`);

    for (let i = 0; i < iframes.length; i++) {
      const iframe = iframes[i];
      console.log(`[ContextManager] Iframe ${i + 1}:`, {
        src: iframe.src,
        name: iframe.name,
        id: iframe.id,
        className: iframe.className,
      });

      // Try to access iframe content (may fail due to CORS)
      try {
        const iframeDoc =
          iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc) {
          const iframeBody = iframeDoc.body;
          if (
            iframeBody &&
            iframeBody.innerText &&
            iframeBody.innerText.length > 100
          ) {
            console.log(
              `[ContextManager] ✅ Found content in iframe: ${iframeBody.innerText.length} chars`
            );
            return iframeBody;
          }
        }
      } catch (error) {
        console.log(
          `[ContextManager] Cannot access iframe content (CORS): ${error.message}`
        );
      }
    }

    // Strategy 3: Look for largest text container on page
    console.log("[ContextManager] Trying largest text container strategy...");
    const allElements = document.querySelectorAll("*");
    let largestElement = null;
    let largestTextLength = 0;

    for (let i = 0; i < Math.min(allElements.length, 100); i++) {
      // Limit to first 100 elements for performance
      const element = allElements[i];

      // Skip extension elements and common non-content elements
      if (this.shouldSkipElement(element)) {
        continue;
      }

      const textContent = element.innerText || element.textContent || "";
      if (textContent.length > largestTextLength && textContent.length > 200) {
        largestTextLength = textContent.length;
        largestElement = element;
      }
    }

    if (largestElement) {
      console.log(
        `[ContextManager] ✅ Found largest text element: ${largestTextLength} chars`
      );
      console.log("[ContextManager] Largest element:", {
        tagName: largestElement.tagName,
        className: largestElement.className,
        id: largestElement.id,
      });
      return largestElement;
    }

    console.log(
      "[ContextManager] ❌ No suitable content element found, using document.body as fallback"
    );
    return document.body;
  }

  // Add this helper method to check if an element is good for Google Docs content
  isGoodGoogleDocsElement(element, elementInfo) {
    // Skip if element is not visible
    if (elementInfo.offsetWidth === 0 || elementInfo.offsetHeight === 0) {
      console.log("[ContextManager] Skipping invisible element");
      return false;
    }

    // Skip if element has no text content
    if (elementInfo.textLength < 50) {
      console.log(
        `[ContextManager] Skipping element with insufficient text: ${elementInfo.textLength} chars`
      );
      return false;
    }

    // Prefer elements with Google Docs specific characteristics
    const hasGoodClassName =
      elementInfo.className &&
      (elementInfo.className.includes("kix-") ||
        elementInfo.className.includes("docs-") ||
        elementInfo.className.includes("editor") ||
        elementInfo.className.includes("content"));

    const hasGoodRole =
      elementInfo.role === "textbox" || elementInfo.role === "document";

    const hasGoodAriaLabel =
      elementInfo.ariaLabel &&
      (elementInfo.ariaLabel.toLowerCase().includes("document") ||
        elementInfo.ariaLabel.toLowerCase().includes("editor"));

    // Score the element
    let score = 0;
    if (hasGoodClassName) score += 3;
    if (hasGoodRole) score += 2;
    if (hasGoodAriaLabel) score += 2;
    if (elementInfo.textLength > 500) score += 2;
    if (elementInfo.textLength > 1000) score += 1;

    console.log(`[ContextManager] Element score: ${score}`, {
      hasGoodClassName,
      hasGoodRole,
      hasGoodAriaLabel,
      textLength: elementInfo.textLength,
    });

    // Return true if score is high enough
    return score >= 3;
  }

  // Add this helper method to skip irrelevant elements

  shouldSkipElement(element) {
    // Safe way to get className as string
    const className =
      element.className && element.className.toString
        ? element.className.toString()
        : element.className || "";

    const id = element.id || "";
    const tagName = element.tagName.toLowerCase();

    // Skip extension elements
    if (
      className.includes("sidepanel") ||
      className.includes("extension") ||
      className.includes("chrome-extension") ||
      id.includes("extension")
    ) {
      return true;
    }

    // Skip navigation, header, footer elements
    if (
      tagName === "nav" ||
      tagName === "header" ||
      tagName === "footer" ||
      className.includes("nav") ||
      className.includes("header") ||
      className.includes("footer") ||
      className.includes("menu")
    ) {
      return true;
    }

    // Skip script, style, meta elements
    if (
      tagName === "script" ||
      tagName === "style" ||
      tagName === "meta" ||
      tagName === "link"
    ) {
      return true;
    }

    return false;
  }

  // Add this helper method to extract text from elements
  extractTextFromElement(element) {
    if (!element) return "";

    // Try different text extraction methods
    const methods = [
      () => element.innerText,
      () => element.textContent,
      () => element.innerHTML.replace(/<[^>]*>/g, " "), // Strip HTML tags
    ];

    for (const method of methods) {
      try {
        const text = method();
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      } catch (error) {
        // Continue to next method
      }
    }

    return "";
  }

  // Add this fallback extraction method
  fallbackExtraction() {
    console.log("[ContextManager] Attempting fallback extraction...");

    // Try to get any visible text content from the page
    const fallbackSelectors = [
      "body",
      "main",
      '[role="main"]',
      "article",
      ".content",
      "#content",
    ];

    for (const selector of fallbackSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          const text = this.extractTextFromElement(element);
          if (text && text.length > 50) {
            // Only if we get meaningful content
            console.log(
              `[ContextManager] Fallback extraction successful with ${selector}`
            );
            return text;
          }
        }
      } catch (error) {
        console.warn(
          `[ContextManager] Fallback failed for ${selector}:`,
          error
        );
      }
    }

    return "";
  }

  // Add this new method to extract Google Docs content
  async extractGoogleDocsContent(rawContext) {
    console.log(
      "[ContextManager] === NEW VERSION GOOGLE DOCS EXTRACTION START ==="
    ); // Add this line
    console.log("[ContextManager] URL:", rawContext.url);
    console.log("[ContextManager] Title:", rawContext.title);

    let extractedText = "";

    // PHASE 1: Try DOM extraction first (fast method)
    console.log("[ContextManager] PHASE 1: Attempting DOM extraction...");
    extractedText = this.tryDOMExtraction();

    if (extractedText && extractedText.length > 50) {
      console.log(
        `[ContextManager] ✅ DOM extraction successful: ${extractedText.length} chars`
      );
      console.log(
        "[ContextManager] DOM content preview:",
        extractedText.substring(0, 100) + "..."
      );
      return this.cleanText(extractedText);
    }

    console.log(
      "[ContextManager] ❌ DOM extraction failed or insufficient content"
    );
    console.log(`[ContextManager] DOM result length: ${extractedText.length}`);

    // PHASE 2: Try Select All method (fallback) - NOW PROPERLY ASYNC
    console.log(
      "[ContextManager] PHASE 2: Attempting Select All extraction..."
    );
    try {
      extractedText = await this.trySelectAllExtraction();

      if (extractedText && extractedText.length > 50) {
        console.log(
          `[ContextManager] ✅ Select All extraction successful: ${extractedText.length} chars`
        );
        console.log(
          "[ContextManager] Select All content preview:",
          extractedText.substring(0, 100) + "..."
        );
        return this.cleanText(extractedText);
      }

      console.log("[ContextManager] ❌ Select All extraction also failed");
      console.log(
        `[ContextManager] Select All result length: ${
          extractedText ? extractedText.length : 0
        }`
      );
    } catch (error) {
      console.error("[ContextManager] Select All extraction error:", error);
    }

    // PHASE 3: Final fallback to raw content
    console.log("[ContextManager] PHASE 3: Using raw content fallback...");
    if (rawContext.mainContent && rawContext.mainContent.length > 10) {
      console.log(
        `[ContextManager] ✅ Using raw mainContent: ${rawContext.mainContent.length} chars`
      );
      return this.cleanText(rawContext.mainContent);
    }

    console.log("[ContextManager] ❌ All extraction methods failed");
    console.log("[ContextManager] === GOOGLE DOCS EXTRACTION END ===");
    return "";
  }

  // Add this helper method to extract text from elements
  extractTextFromElement(element) {
    if (!element) return "";

    // Try different text extraction methods
    const methods = [
      () => element.innerText,
      () => element.textContent,
      () => element.innerHTML.replace(/<[^>]*>/g, " "), // Strip HTML tags
    ];

    for (const method of methods) {
      try {
        const text = method();
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      } catch (error) {
        // Continue to next method
      }
    }

    return "";
  }

  // Add this fallback extraction method
  fallbackExtraction() {
    console.log("[ContextManager] Attempting fallback extraction...");

    // Try to get any visible text content from the page
    const fallbackSelectors = [
      "body",
      "main",
      '[role="main"]',
      "article",
      ".content",
      "#content",
    ];

    for (const selector of fallbackSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          const text = this.extractTextFromElement(element);
          if (text && text.length > 50) {
            // Only if we get meaningful content
            console.log(
              `[ContextManager] Fallback extraction successful with ${selector}`
            );
            return text;
          }
        }
      } catch (error) {
        console.warn(
          `[ContextManager] Fallback failed for ${selector}:`,
          error
        );
      }
    }

    return "";
  }

  cleanText(text) {
    if (!text) return "";

    // Remove extra whitespace and clean up
    return text
      .replace(/\s+/g, " ") // Multiple spaces to single space
      .replace(/\n\s*\n/g, "\n") // Multiple newlines to single
      .trim();
  }

  setButtonState(state) {
    if (!this.loadButton) return;

    // Remove all state classes
    this.loadButton.classList.remove("loading", "loaded", "error");
    this.loadButton.setAttribute("data-state", state);

    // Update button appearance based on state
    switch (state) {
      case "loading":
        this.loadButton.classList.add("loading");
        this.loadButton.disabled = true;
        this.loadButton.title = "Loading context...";
        break;

      case "loaded":
        this.loadButton.classList.add("loaded");
        this.loadButton.disabled = false;
        this.loadButton.title = "Context loaded - click to refresh";
        break;

      case "error":
        this.loadButton.disabled = false;
        this.loadButton.title = "Failed to load context - click to retry";
        break;

      default: // 'default'
        this.loadButton.disabled = false;
        this.loadButton.title = "Load page context";
    }
  }

  showContextBar(context) {
    if (!this.contextBar || !this.contextText) return;

    // Update context text
    const contextInfo = `${context.title} (${context.wordCount} words)`;
    this.contextText.textContent = contextInfo;

    // Show context bar
    this.contextBar.style.display = "flex";

    // Show clear button
    if (this.clearButton) {
      this.clearButton.style.display = "flex";
    }
  }

  clearContext() {
    console.log("[ContextManager] Clearing context");

    // Clear stored context
    this.currentContext = null;
    this.isLoaded = false;

    // Reset button state
    this.setButtonState("default");

    // Hide context bar
    if (this.contextBar) {
      this.contextBar.style.display = "none";
    }

    // Hide clear button
    if (this.clearButton) {
      this.clearButton.style.display = "none";
    }
  }

  // Method to get context for including in messages
  getContextForMessage() {
    if (!this.isLoaded || !this.currentContext) {
      return null;
    }

    return this.currentContext;
  }

  // Check if context is loaded
  hasContext() {
    return this.isLoaded && this.currentContext !== null;
  }
}

// Add this CSS class for the pulse effect
const contextAvailableCSS = `
.context-load-btn.context-available {
  animation: contextPulse 2s ease-in-out;
}

@keyframes contextPulse {
  0%, 100% { 
    background: transparent; 
    color: var(--text-muted);
  }
  50% { 
    background: rgba(14, 165, 233, 0.1); 
    color: var(--blue-600);
  }
}
`;

// Inject the CSS
const style = document.createElement("style");
style.textContent = contextAvailableCSS;
document.head.appendChild(style);

// app.js — CompanyGPTChat (updated to use ContextManager and no automatic context switching)

class CompanyGPTChat {
  constructor() {
    this.chatController = null;
    this.messageRenderer = null;
    this.contextAnalyzer = null;
    this.currentTabInfo = null;
    this.isInitialized = false;
    this.isAuthenticated = false; // Track auth state
    this.authCheckInProgress = false; // Prevent multiple auth checks

    // Session/context management (kept minimal)
    this.lastKnownUrl = null;
    this.lastKnownDomain = null;
    this.sessionStartTime = null;

    // NEW: ContextManager instance
    this.contextManager = null;
  }

  async initialize() {
    console.log("[App] Initializing CompanyGPT Chat...");

    try {
      // Initialize modules (but not chat controller yet)
      this.messageRenderer = new MessageRenderer();
      this.contextAnalyzer = new ContextAnalyzer();

      // Setup UI elements FIRST
      this.setupUIElements();

      // Setup event listeners
      this.setupEventListeners();

      // Load initial context
      await this.loadPageContext();

      // Initialize context manager AFTER UI setup and initial context
      this.contextManager = new ContextManager(this);

      // Check authentication (this will show login overlay if needed)
      this.isAuthenticated = await this.checkAuth();

      // Only initialize chat if authenticated
      if (this.isAuthenticated) {
        await this.initializeChat();
      }

      this.isInitialized = true;
      console.log("[App] Initialization complete");
    } catch (error) {
      console.error("[App] Initialization failed:", error);
      this.showError("Initialisierung fehlgeschlagen: " + error.message);
    }
  }

  // === UI SETUP ===
  setupUIElements() {
    this.elements = {
      // Views
      viewChat: document.getElementById("view-chat"),
      viewSettings: document.getElementById("view-settings"),

      // Icon buttons
      btnChat: document.getElementById("btn-chat"),
      btnSettings: document.getElementById("btn-settings"),
      btnClose: document.getElementById("btn-close"),

      // Chat elements
      messagesContainer: document.getElementById("chat-messages"),
      messageInput: document.getElementById("message-input"),
      sendButton: document.getElementById("send-button"),

      // Settings
      currentDomain: document.getElementById("current-domain"),
      useContext: document.getElementById("use-context"),

      // Login overlay elements
      loginOverlay: document.getElementById("login-overlay"),
      btnLogin: document.getElementById("btn-login"),
      btnCheckAuth: document.getElementById("btn-check-auth"),
      loginHint: document.getElementById("login-hint"),
      domainStatus: document.getElementById("domain-status"),
      detectedDomain: document.getElementById("detected-domain"),
      domainInputGroup: document.getElementById("domain-input-group"),
      domainInput: document.getElementById("domain-input"),
    };

    // Debug: log missing elements (only if they're actually missing)
    const missing = Object.entries(this.elements)
      .filter(([_, el]) => !el)
      .map(([key]) => key);

    if (missing.length > 0) {
      console.warn("[App] Missing UI elements:", missing);
    }
  }

  setupEventListeners() {
    // Icon button navigation
    this.elements.btnChat?.addEventListener("click", () => {
      this.showView("chat");
      this.setActiveButton("btnChat");
    });

    this.elements.btnSettings?.addEventListener("click", () => {
      this.showView("settings");
      this.setActiveButton("btnSettings");
    });

    this.elements.btnClose?.addEventListener("click", () => {
      window.close();
    });

    // Send message
    this.elements.sendButton?.addEventListener("click", () =>
      this.sendMessage()
    );

    // Enter key to send (but allow Shift+Enter for new line)
    this.elements.messageInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-resize textarea
    this.elements.messageInput?.addEventListener("input", (e) => {
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px";
    });

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message) => {
      this.handleBackgroundMessage(message);
    });

    // Listen for tab activation (user switches tabs)
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      // Small delay to let the tab fully load
      setTimeout(() => {
        this.handleTabChange(activeInfo.tabId);
      }, 100);
    });

    // Also listen for URL changes in the same tab
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url && tab.active) {
        console.log("[App] URL changed in active tab:", changeInfo.url);
        setTimeout(() => {
          this.handleTabChange(tabId);
        }, 100);
      }
    });

    // Login overlay listeners
    this.elements.btnLogin?.addEventListener("click", () => this.handleLogin());
    this.elements.btnCheckAuth?.addEventListener("click", () =>
      this.recheckAuth()
    );

    // Domain input enter key
    this.elements.domainInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.handleLogin();
      }
    });

    // Better tab change detection
    let lastActiveTabUrl = null;

    // Check for tab changes every time user focuses the side panel
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden && this.isInitialized) {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab && tab.url !== lastActiveTabUrl) {
          lastActiveTabUrl = tab.url;
          await this.handleTabChange(tab.id);
        }
      }
    });

    // Also listen for tab activation (debounced)
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      if (this.isInitialized) {
        setTimeout(async () => {
          const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (tab && tab.url !== lastActiveTabUrl) {
            lastActiveTabUrl = tab.url;
            await this.handleTabChange(activeInfo.tabId);
          }
        }, 100);
      }
    });
  }

  setActiveButton(buttonName) {
    // Remove active class from all buttons
    this.elements.btnChat?.classList.remove("active");
    this.elements.btnSettings?.classList.remove("active");

    // Add active class to selected button
    this.elements[buttonName]?.classList.add("active");
  }

  showView(which) {
    const isChat = which === "chat";

    if (isChat) {
      this.elements.viewChat?.style.removeProperty("display");
      this.elements.viewSettings?.style.setProperty("display", "none");
    } else {
      this.elements.viewChat?.style.setProperty("display", "none");
      this.elements.viewSettings?.style.removeProperty("display");
    }
  }

  // === LOGIN OVERLAY ===
  showLoginOverlay(detectedDomain = null) {
    console.log("[App] Showing login overlay, domain:", detectedDomain);

    // Show overlay
    if (this.elements.loginOverlay) {
      this.elements.loginOverlay.style.display = "flex";
    }

    // Blur background messages
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.classList.add("blurred");
    }

    // Handle domain detection display - with null checks
    if (detectedDomain && this.elements.domainStatus) {
      this.elements.domainStatus.style.display = "block";
      this.elements.detectedDomain &&
        (this.elements.detectedDomain.textContent = detectedDomain + ".506.ai");
      this.elements.domainInputGroup &&
        (this.elements.domainInputGroup.style.display = "none");
    } else {
      this.elements.domainStatus &&
        (this.elements.domainStatus.style.display = "none");
      this.elements.domainInputGroup &&
        (this.elements.domainInputGroup.style.display = "block");
    }

    // Reset buttons with null checks
    this.elements.btnLogin && (this.elements.btnLogin.style.display = "block");
    this.elements.btnCheckAuth &&
      (this.elements.btnCheckAuth.style.display = "none");
    this.elements.loginHint && (this.elements.loginHint.style.display = "none");

    // Disable input
    this.updateAuthStatus(false, detectedDomain);
  }

  hideLoginOverlay() {
    console.log("[App] Hiding login overlay");

    // Hide overlay
    if (this.elements.loginOverlay) {
      this.elements.loginOverlay.style.display = "none";
    }

    // Unblur messages
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.classList.remove("blurred");
    }
  }

  async handleLogin() {
    console.log("[App] Opening login page");

    try {
      let loginUrl = "";
      let domain = "";

      // Try to get domain from CONFIG
      if (window.CONFIG?.DOMAIN) {
        domain = window.CONFIG.DOMAIN;
      }

      // If no domain from CONFIG, check AuthService
      if (!domain && window.AuthService?.getActiveDomain) {
        domain = window.AuthService.getActiveDomain();
      }

      // If still no domain, check the input field
      if (!domain && this.elements.domainInput) {
        const inputValue = this.elements.domainInput.value.trim();
        if (inputValue) {
          // Validate subdomain format
          if (!/^[a-z0-9-]+$/.test(inputValue)) {
            alert(
              "Ungültige Subdomain. Bitte nur Kleinbuchstaben, Zahlen und Bindestriche verwenden."
            );
            return;
          }
          domain = inputValue;

          // Save for future use
          await chrome.storage.local.set({ lastKnownDomain: domain });
        }
      }

      // If still no domain, prompt user
      if (!domain) {
        const subdomain = prompt(
          'Bitte gib deine Firmen-Subdomain ein (z.B. "firma" für firma.506.ai):'
        );
        if (!subdomain) {
          return;
        }
        domain = subdomain.trim().toLowerCase();

        // Save for future use
        await chrome.storage.local.set({ lastKnownDomain: domain });
      }

      // Build login URL
      loginUrl = `https://${domain}.506.ai/de/login?callbackUrl=%2F`;

      console.log("[App] Opening login URL:", loginUrl);

      // Open login in new tab
      await chrome.tabs.create({ url: loginUrl });

      // Update UI to show waiting state
      this.elements.btnLogin && (this.elements.btnLogin.style.display = "none");
      this.elements.btnCheckAuth &&
        (this.elements.btnCheckAuth.style.display = "block");
      this.elements.loginHint &&
        (this.elements.loginHint.style.display = "flex");

      // Update domain display if it wasn't shown before
      if (domain && this.elements.domainStatus) {
        this.elements.domainStatus.style.display = "block";
        this.elements.detectedDomain &&
          (this.elements.detectedDomain.textContent = domain + ".506.ai");
        this.elements.domainInputGroup &&
          (this.elements.domainInputGroup.style.display = "none");
      }

      // Wait for user to click "Anmeldung prüfen"
    } catch (error) {
      console.error("[App] Failed to open login:", error);
      this.showError("Fehler beim Öffnen der Anmeldeseite");
    }
  }

  // === AUTH FLOW ===
  async recheckAuth() {
    console.log("[App] Rechecking authentication...");

    // Prevent multiple simultaneous checks
    if (this.authCheckInProgress) {
      console.log("[App] Auth check already in progress, skipping");
      return;
    }

    this.authCheckInProgress = true;

    // Show loading state
    if (this.elements.btnCheckAuth) {
      this.elements.btnCheckAuth.textContent = "Prüfe...";
      this.elements.btnCheckAuth.disabled = true;
    }

    try {
      // Clear any cached auth state
      if (window.AuthService?.clearCache) {
        window.AuthService.clearCache();
      }

      // Force clear the CONFIG cache to re-detect domain
      if (window.CONFIG) {
        console.log("[App] Reloading config to detect cookies...");
        const script = document.createElement("script");
        script.src = "../shared/config.js?" + Date.now(); // Force reload with cache buster
        document.head.appendChild(script);
      }

      // Wait longer for cookies to be properly set
      console.log("[App] Waiting for cookies to be set...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Try to directly check for the cookie
      const cookieCheck = await this.checkCookieDirectly();
      console.log("[App] Direct cookie check result:", cookieCheck);

      // Force refresh auth check
      const isAuthenticated = await this.checkAuth();
      console.log("[App] Auth check result:", isAuthenticated);

      if (isAuthenticated || cookieCheck) {
        // Success! Hide overlay and initialize
        console.log("[App] Authentication successful!");
        this.hideLoginOverlay();
        this.isAuthenticated = true;

        // Initialize chat
        await this.initializeChat();

        // Update the UI to show success
        if (this.elements.messagesContainer) {
          this.elements.messagesContainer.innerHTML = `
            <div class="message assistant">
              ✅ Erfolgreich angemeldet! Ich kann dir jetzt bei Fragen zur aktuellen Seite helfen.
            </div>
          `;
        }
      } else {
        // Still not authenticated - reset button
        if (this.elements.btnCheckAuth) {
          this.elements.btnCheckAuth.textContent = "Anmeldung prüfen";
          this.elements.btnCheckAuth.disabled = false;
        }

        // Show helpful message
        this.showError(
          "Noch nicht angemeldet. Falls du dich gerade angemeldet hast, warte einen Moment und versuche es erneut."
        );
      }
    } catch (error) {
      console.error("[App] Auth recheck failed:", error);

      // Reset button state
      if (this.elements.btnCheckAuth) {
        this.elements.btnCheckAuth.textContent = "Anmeldung prüfen";
        this.elements.btnCheckAuth.disabled = false;
      }

      this.showError("Fehler beim Prüfen der Anmeldung: " + error.message);
    } finally {
      this.authCheckInProgress = false;
    }
  }

  // New: direct cookie check
  async checkCookieDirectly() {
    try {
      const cookies = await chrome.cookies.getAll({
        domain: ".506.ai",
        name: "__Secure-next-auth.session-token",
      });

      console.log("[App] Found cookies:", cookies.length);

      if (cookies && cookies.length > 0) {
        // Check if any cookie is not expired
        const now = Date.now() / 1000;
        const validCookie = cookies.find((cookie) => {
          return !cookie.expirationDate || cookie.expirationDate > now;
        });

        if (validCookie) {
          console.log("[App] Valid session cookie found!");

          // Extract domain from cookie
          const domain = validCookie.domain
            .replace(/^\./, "")
            .replace(".506.ai", "");

          // Update auth status
          this.updateAuthStatus(true, domain);

          return true;
        }
      }

      return false;
    } catch (error) {
      console.error("[App] Direct cookie check failed:", error);
      return false;
    }
  }

  // Resilient auth check
  async checkAuth() {
    console.log("[App] Checking authentication...");

    try {
      let isAuth = false;
      let domain = null;

      // First try direct cookie check
      const hasCookie = await this.checkCookieDirectly();

      if (hasCookie) {
        isAuth = true;

        // Get domain from cookies
        const cookies = await chrome.cookies.getAll({
          domain: ".506.ai",
          name: "__Secure-next-auth.session-token",
        });

        if (cookies.length > 0) {
          domain = cookies[0].domain.replace(/^\./, "").replace(".506.ai", "");
        }
      } else if (window.AuthService) {
        // Fall back to AuthService
        isAuth = await window.AuthService.checkAuth();
        domain = window.AuthService.getActiveDomain?.();
      } else {
        // Final fallback to message-based auth check
        try {
          const response = await chrome.runtime.sendMessage({
            type: "CHECK_AUTH",
          });

          if (response?.success && response?.isAuthenticated) {
            isAuth = true;
            domain = response.domain;
          }
        } catch (msgError) {
          console.warn("[App] Message-based auth check failed:", msgError);
        }
      }

      this.updateAuthStatus(isAuth, domain);

      // Only show/hide overlay if not already checking
      if (!this.authCheckInProgress) {
        if (!isAuth) {
          this.showLoginOverlay(domain);
        } else {
          this.hideLoginOverlay();
        }
      }

      console.log("[App] Auth result:", isAuth, "Domain:", domain);
      return isAuth;
    } catch (error) {
      console.error("[App] Auth check failed:", error);
      this.updateAuthStatus(false);

      // Only show overlay if this is not a recheck
      if (!this.authCheckInProgress) {
        this.showLoginOverlay(null);
      }

      return false;
    }
  }

  updateAuthStatus(isAuthenticated, domain = null) {
    this.isAuthenticated = isAuthenticated;

    if (this.elements.currentDomain && domain) {
      this.elements.currentDomain.textContent = domain + ".506.ai";
    } else if (this.elements.currentDomain) {
      this.elements.currentDomain.textContent = "Nicht verbunden";
    }

    // Enable/disable chat based on auth
    if (this.elements.messageInput) {
      this.elements.messageInput.disabled = !isAuthenticated;
      this.elements.messageInput.placeholder = isAuthenticated
        ? "Nachricht an CompanyGPT"
        : "Bitte melde dich erst bei CompanyGPT an";
    }

    if (this.elements.sendButton) {
      this.elements.sendButton.disabled = !isAuthenticated;
    }
  }

  // === CONTEXT (lightweight) ===
  async loadPageContext() {
    if (!this.loadButton) return;

    console.log("[ContextManager] === LOAD PAGE CONTEXT START ===");

    // Set loading state
    this.setButtonState("loading");

    try {
      // Get page context using existing method
      const context = await this.app.getPageContext();
      console.log("[ContextManager] Raw context received:", context);

      if (!context) {
        throw new Error("No context available");
      }

      // Process and clean the context (now properly awaited)
      console.log("[ContextManager] About to process context...");
      const processedContext = await this.processContext(context);
      console.log(
        "[ContextManager] Context processing completed:",
        processedContext
      );

      // Store context
      this.currentContext = processedContext;
      this.isLoaded = true;

      // Update UI
      this.setButtonState("loaded");
      this.showContextBar(processedContext);

      console.log("[ContextManager] === LOAD PAGE CONTEXT SUCCESS ===");
      console.log(
        "[ContextManager] Final processed context:",
        processedContext
      );
    } catch (error) {
      console.error("[ContextManager] === LOAD PAGE CONTEXT FAILED ===");
      console.error("[ContextManager] Error details:", error);
      this.setButtonState("error");

      // Reset after 3 seconds
      setTimeout(() => {
        this.setButtonState("default");
      }, 3000);
    }
  }

  updateContextDisplay() {
    // Context is handled internally; add UI if needed later
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return "";
    }
  }

  // === CHAT ===
  async sendMessage() {
    const message = this.elements.messageInput?.value?.trim();
    if (!message) return;

    console.log("[App] Sending message:", message);

    // Check if authenticated
    if (!this.isAuthenticated) {
      this.showError("Bitte melde dich erst an");
      return;
    }

    // Check if chat controller is initialized
    if (!this.chatController || !this.chatController.isInitialized) {
      console.log("[App] ChatController not ready, initializing...");
      try {
        await this.initializeChat();
      } catch (error) {
        this.showError("Chat konnte nicht initialisiert werden");
        return;
      }
    }

    // No automatic context switching — rely on ContextManager if user loaded one
    await this.processSendMessage(message);
  }
  // Replace the entire processSendMessage method in your app.js with this:

  async processSendMessage(message) {
    // Clear input and reset height
    this.elements.messageInput.value = "";
    this.elements.messageInput.style.height = "auto";

    // Add user message to UI
    this.addMessage(message, "user");

    // Show typing indicator
    const typingId = this.showTypingIndicator();

    try {
      console.log("[App] Processing message with context manager...");

      // NEW: Get context from context manager ONLY
      let context = null;
      if (this.contextManager && this.contextManager.hasContext()) {
        context = this.contextManager.getContextForMessage();
        console.log("[App] Using loaded context from ContextManager:", context);
      } else {
        console.log("[App] No context loaded in ContextManager");
      }

      console.log("[App] Calling ChatController.sendMessage...");

      // Send to CompanyGPT API via ChatController
      const response = await this.chatController.sendMessage(message, context);

      console.log("[App] Got response:", response);

      // Remove typing indicator
      this.removeTypingIndicator(typingId);

      // Add assistant response
      this.addMessage(response.content, "assistant");
    } catch (error) {
      console.error("[App] Failed to send message:", error);
      this.removeTypingIndicator(typingId);
      this.addMessage(`Fehler: ${error.message}`, "error");
    }
  }
  async getPageContext() {
    try {
      console.log("[App] Requesting page context...");

      // Try to get context from content script
      const response = await chrome.runtime.sendMessage({
        type: "GET_PAGE_CONTEXT",
      });

      if (response && response.success !== false) {
        console.log("[App] Got page context:", response);
        return response;
      }

      // Fallback to basic tab info
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (tab) {
        const context = {
          title: tab.title,
          url: tab.url,
          selectedText: "",
          mainContent: "",
        };
        console.log("[App] Using tab context:", context);
        return context;
      }
    } catch (error) {
      console.error("[App] Failed to get page context:", error);
    }

    return null;
  }

  async initializeChat() {
    try {
      console.log("[App] Initializing chat controller...");

      if (!this.chatController) {
        this.chatController = new ChatController();
      }

      // Initialize only if not already initialized
      if (!this.chatController.isInitialized) {
        const success = await this.chatController.initialize();
        if (!success) {
          throw new Error("Chat controller initialization failed");
        }
      }

      console.log("[App] Chat controller ready");

      // Show success message if this is first init
      if (
        this.elements.messagesContainer &&
        !this.elements.messagesContainer.querySelector(".welcome-shown")
      ) {
        this.elements.messagesContainer.innerHTML = `
          <div class="message assistant welcome-shown">
            ✅ Chat bereit! Du kannst jetzt Fragen stellen.
          </div>
        `;
      }
    } catch (error) {
      console.error("[App] Chat initialization failed:", error);
      throw error;
    }
  }

  addMessage(content, role = "assistant") {
    const messageEl = document.createElement("div");
    messageEl.className = `message ${role}`;

    // Handle system messages with icon
    if (role === "system") {
      messageEl.innerHTML = `<span class="system-icon">ℹ️</span> ${content}`;
    } else {
      messageEl.textContent = content;
    }

    this.elements.messagesContainer?.appendChild(messageEl);
    this.scrollToBottom();
  }

  showTypingIndicator() {
    const typingEl = document.createElement("div");
    typingEl.className = "typing-indicator";
    typingEl.id = `typing-${Date.now()}`;
    typingEl.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;

    this.elements.messagesContainer?.appendChild(typingEl);
    this.scrollToBottom();

    return typingEl.id;
  }

  removeTypingIndicator(id) {
    document.getElementById(id)?.remove();
  }

  scrollToBottom() {
    if (this.elements.messagesContainer) {
      this.elements.messagesContainer.scrollTop =
        this.elements.messagesContainer.scrollHeight;
    }
  }

  startNewChat() {
    if (
      confirm("Neuen Chat starten? Die aktuelle Unterhaltung wird gelöscht.")
    ) {
      // Clear all messages
      this.elements.messagesContainer.innerHTML = `
        <div class="message assistant">
          Neuer Chat gestartet. Ich kann dir bei Fragen zur aktuellen Seite helfen. ✨
        </div>
      `;
      this.chatController?.clearChat();
    }
  }

  // === BROWSER/TABS/MSG ===
  async handleTabChange(tabId) {
    console.log("[App] Tab changed:", tabId);
    await this.loadPageContext();
  }

  handleBackgroundMessage(message) {
    switch (message.type) {
      case "TAB_INFO":
        this.currentTabInfo = message.data;
        this.loadPageContext();
        break;
      case "AUTH_STATE_CHANGED":
        // Re-check auth when auth state changes
        if (!this.authCheckInProgress) {
          this.checkAuth();
        }
        break;
      default:
        console.log("[App] Unknown message type:", message.type);
    }
  }

  showError(message) {
    console.error("[App]", message);

    // Only add to chat if container exists
    if (this.elements.messagesContainer) {
      const errorEl = document.createElement("div");
      errorEl.className = "message error";
      errorEl.textContent = message;
      this.elements.messagesContainer.appendChild(errorEl);
      this.scrollToBottom();
    }
  }
}

// Initialize app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    const app = new CompanyGPTChat();
    app.initialize();
    window.companyGPTChat = app;
  });
} else {
  const app = new CompanyGPTChat();
  app.initialize();
  window.companyGPTChat = app;
}
