// content/content-script.js
(function () {
  // Guard for existing instance
  if (window.__companyGPTExtractorLoaded && window.__companyGPTExtractor) {
    console.log(
      "[CompanyGPT Extension] Content script already loaded and functional"
    );
    if (window.__companyGPTExtractor.setupMessageListener) {
      window.__companyGPTExtractor.setupMessageListener();
    }
    return;
  }

  // Add context invalidation detection up front
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    // Cleanup on page unload (navigations, tab close, etc.)
    window.addEventListener("beforeunload", () => {
      if (window.__companyGPTExtractor?.cleanup) {
        window.__companyGPTExtractor.cleanup();
      }
    });

    // Also listen for extension port disconnects (reload/disable)
    chrome.runtime.onConnect?.addListener((port) => {
      port.onDisconnect.addListener(() => {
        console.log("[ContentExtractor] Extension disconnected");
        if (window.__companyGPTExtractor?.cleanup) {
          window.__companyGPTExtractor.cleanup();
        }
      });
    });
  }

  console.log("[CompanyGPT Extension] Content script initializing...");

  // Complete EmailHandler class
  class EmailHandler {
    constructor() {
      this.url = window.location.href;
      this.hostname = window.location.hostname;
      this.provider = this.detectProvider();
      console.log(
        `[EmailHandler] Initialized for ${this.provider || "unknown"} provider`
      );
    }

    detectProvider() {
      if (this.hostname.includes("mail.google.com")) return "gmail";
      if (
        this.hostname.includes("outlook.office.com") ||
        this.hostname.includes("outlook.live.com")
      )
        return "outlook";
      return null;
    }

    isEmailProvider() {
      return this.provider !== null;
    }

    extract() {
      if (!this.provider) {
        return {
          success: false,
          error: "Not an email provider",
        };
      }

      console.log(`[EmailHandler] Extracting from ${this.provider}`);

      if (this.provider === "outlook") {
        return this.extractOutlook();
      } else if (this.provider === "gmail") {
        return this.extractGmail();
      }

      return { success: false, error: "Provider not implemented" };
    }

    extractOutlook() {
      // Get subject from title or heading
      let subject = document.querySelector('[role="heading"]')?.innerText || "";
      if (!subject) {
        const titleMatch = document.title.match(/^(.+?) [–-] /);
        subject = titleMatch
          ? titleMatch[1]
          : document.title.replace(/ [–-] .*$/, "");
      }

      // Get email body from main content area
      const emailContainer =
        document.querySelector(".ReadingPaneContents") ||
        document.querySelector('[role="main"]') ||
        document.querySelector(".customScrollBar");
      const content = emailContainer?.innerText || document.body.innerText;

      return {
        success: true,
        provider: "outlook",
        subject: subject,
        content: content,
        messages: [
          {
            index: 1,
            sender: "Unknown",
            timestamp: "",
            body: content,
          },
        ],
        metadata: {
          messageCount: 1,
          hasSubject: !!subject,
          extractionMethod: "outlook-dom",
          isEmail: true,
          emailProvider: "outlook",
        },
      };
    }

    extractNameFromEmail(senderString) {
      if (!senderString) return null;

      // If it's just an email, extract the part before @
      if (senderString.includes("@") && !senderString.includes("<")) {
        return senderString.split("@")[0].replace(/[._-]/g, " ").trim();
      }

      // If it's "Name <email>", extract Name
      const match = senderString.match(/^([^<]+)</);
      if (match) {
        return match[1].trim();
      }

      return senderString.trim();
    }

    extractGmail() {
      const messages = [];

      // Get email subject
      const subjectEl = document.querySelector("h2[data-legacy-thread-id]");
      const subject = subjectEl?.innerText || "";

      // Try multiple strategies to get all messages

      // Strategy 1: Get expanded messages (current view)
      const expandedMessages = document.querySelectorAll(".ii.gt");

      // Strategy 2: Get collapsed message previews
      const collapsedMessages = document.querySelectorAll(".kv, .kQ");

      // Strategy 3: Get all message containers (includes both)
      const allMessageContainers = document.querySelectorAll(
        '[jsaction*="email"]'
      );

      // Strategy 4: Look for specific Gmail message structure
      const gmailMessages = document.querySelectorAll(".h7, .g6, .nH.if");

      console.log("[Gmail Extractor] Found elements:", {
        expanded: expandedMessages.length,
        collapsed: collapsedMessages.length,
        containers: allMessageContainers.length,
        gmail: gmailMessages.length,
      });

      // Try to extract from expanded messages first
      expandedMessages.forEach((msgEl, index) => {
        // Find the parent container that has sender info
        const container =
          msgEl.closest(".h7") || msgEl.closest(".g6") || msgEl.parentElement;

        // Get sender
        const senderEl =
          container?.querySelector("span[email]") ||
          container?.querySelector(".gD") ||
          container?.querySelector(".go span");
        const sender =
          senderEl?.getAttribute("email") ||
          senderEl?.innerText ||
          "Unknown sender";

        // Get message body
        const bodyText = msgEl.innerText || "";

        // Get timestamp if available
        const timeEl =
          container?.querySelector(".g3") ||
          container?.querySelector('[title*=":"]');
        const timestamp =
          timeEl?.getAttribute("title") || timeEl?.innerText || "";

        if (bodyText && bodyText.trim()) {
          messages.push({
            index: index + 1,
            sender: sender.trim(),
            timestamp: timestamp,
            body: bodyText.trim(),
          });
        }
      });

      // If we didn't get all messages, try collapsed ones
      if (messages.length < 2) {
        // Look for the "show trimmed content" or collapsed messages
        const quotedText = document.querySelectorAll(".ajR .ajT");
        quotedText.forEach((btn) => btn.click()); // Expand quoted text

        // Also try to get the previous messages in thread
        const threadMessages = document.querySelectorAll("[data-message-id]");
        threadMessages.forEach((msgEl) => {
          const sender =
            msgEl.querySelector(".gD")?.innerText ||
            msgEl.querySelector("[email]")?.getAttribute("email") ||
            "Unknown";
          const body = msgEl.querySelector(".a3s")?.innerText || "";

          if (body && !messages.find((m) => m.body === body.trim())) {
            messages.push({
              index: messages.length + 1,
              sender: sender,
              timestamp: "",
              body: body.trim(),
            });
          }
        });
      }

      // Last resort: Get all visible text that looks like email content
      if (messages.length === 1) {
        // Check if there's quoted text that wasn't captured
        const quotedBlocks = document.querySelectorAll(
          ".gmail_quote, blockquote"
        );
        quotedBlocks.forEach((block) => {
          const text = block.innerText;
          if (text && text.length > 50) {
            // Probably actual content
            messages.push({
              index: messages.length + 1,
              sender: "Previous message",
              timestamp: "",
              body: text.trim(),
            });
          }
        });
      }

      // Format as single content string
      let content = subject ? `Subject: ${subject}\n\n` : "";

      // Include all messages in chronological order
      messages.forEach((msg, idx) => {
        content += `--- Message ${idx + 1} ---\n`;
        content += `From: ${msg.sender}\n`;
        if (msg.timestamp) content += `Time: ${msg.timestamp}\n`;
        content += `${msg.body}\n\n`;
      });

      // NEW: Extract the actual sender (from the visible message list), not the document title
      const senderElements = document.querySelectorAll(".gD"); // Gmail sender class
      let actualSender = null;
      if (senderElements.length > 0) {
        const last = senderElements[senderElements.length - 1];
        actualSender = last.getAttribute("email") || last.innerText;
      }

      return {
        success: true,
        provider: "gmail",
        subject: subject,
        content: content || "No email content found",
        messages: messages,
        metadata: {
          messageCount: messages.length,
          hasSubject: !!subject,
          extractionMethod: "gmail-dom",
          isEmail: true,
          emailProvider: "gmail",
          threadDetected: messages.length > 1,
          originalSender: actualSender, // ADD THIS
          extractedSenderName: this.extractNameFromEmail(actualSender), // ADD THIS
        },
      };
    }

    formatContent(extractedData) {
      if (!extractedData || !extractedData.success) {
        return "";
      }

      // If content is already formatted, return it
      if (typeof extractedData.content === "string") {
        return extractedData.content;
      }

      // Otherwise format from messages
      let formatted = "";
      if (extractedData.subject) {
        formatted += `Subject: ${extractedData.subject}\n\n`;
      }

      if (extractedData.messages && extractedData.messages.length > 0) {
        extractedData.messages.forEach((msg) => {
          formatted += `From: ${msg.sender}\n`;
          formatted += `${msg.body}\n\n`;
        });
      }

      return formatted;
    }

    async insertReply(content, isHtml = false) {
      console.log(
        `[EmailHandler] Inserting reply for ${this.provider}, HTML: ${isHtml}`
      );

      if (this.provider === "outlook") {
        return this.insertOutlookReply(content, isHtml);
      }
      if (this.provider === "gmail") {
        return this.insertGmailReply(content, isHtml); // Pass isHtml here
      }

      // Generic fallback
      try {
        await navigator.clipboard.writeText(content);
        return { success: true, method: "clipboard" };
      } catch (err) {
        return { success: false, error: err.message, content: content };
      }
    }

    async insertOutlookReply(emailContent) {
      console.log("[EmailHandler] Starting Outlook insertion process...");

      // Clean the content
      let cleanContent = emailContent;
      if (typeof emailContent === "object") {
        cleanContent = emailContent.body || emailContent.content || "";
      }
      cleanContent = cleanContent
        .replace(/^["']|["']$/g, "")
        .replace(/\\n/g, "\n");

      try {
        // Find and click reply button
        const replyButton = document.querySelector(
          'button[aria-label="Antworten"][role="menuitem"]'
        );

        if (replyButton) {
          console.log("[EmailHandler] ✓ Found reply button");
          replyButton.click();

          // Wait for compose area to fully load
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Find the compose area
          let composeArea =
            document.querySelector(
              'div[role="textbox"][aria-label="Nachrichtentext"]'
            ) ||
            document.querySelector("div.elementToProof") ||
            document.querySelector('#editorParent_2 [contenteditable="true"]');

          if (composeArea) {
            console.log("[EmailHandler] ✓ Found compose area");

            // Get the actual editable div
            const editableDiv =
              composeArea.querySelector(".elementToProof") || composeArea;

            // Focus and click
            editableDiv.focus();
            editableDiv.click();

            // Wait for focus
            await new Promise((resolve) => setTimeout(resolve, 300));

            // Clear any existing content
            editableDiv.innerHTML = "";

            // Format the content for Outlook
            // Split by double newlines for paragraphs
            const paragraphs = cleanContent
              .split(/\n\n+/)
              .filter((p) => p.trim());

            // Create proper HTML for Outlook
            const formattedHTML = paragraphs
              .map((para) => {
                // Replace single newlines within paragraphs with <br>
                const formattedPara = para.replace(/\n/g, "<br>");
                // Wrap in div with Outlook's styling
                return `<div style="font-family: Aptos, Aptos_EmbeddedFont, Aptos_MSFontService, Calibri, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">${formattedPara}</div>`;
              })
              .join("<div><br></div>"); // Add empty line between paragraphs

            editableDiv.innerHTML = formattedHTML;

            // Trigger events
            editableDiv.dispatchEvent(new Event("input", { bubbles: true }));
            editableDiv.dispatchEvent(new Event("change", { bubbles: true }));

            console.log(
              "[EmailHandler] ✓ Content inserted with proper formatting"
            );

            // Visual feedback
            editableDiv.style.backgroundColor = "#e8f4f8";
            setTimeout(() => {
              editableDiv.style.backgroundColor = "";
            }, 1000);

            return {
              success: true,
              method: "direct-insert",
              message: "Email-Antwort wurde eingefügt!",
            };
          } else {
            console.warn("[EmailHandler] Compose area not found");
          }
        } else {
          console.warn("[EmailHandler] Reply button not found");
        }

        // Fallback: Copy to clipboard
        await navigator.clipboard.writeText(cleanContent);
        console.log("[EmailHandler] Fallback: Copied to clipboard");

        return {
          success: true,
          method: "clipboard",
          message: "Email kopiert! Klicke ins Antwortfeld und drücke Strg+V",
        };
      } catch (error) {
        console.error("[EmailHandler] Error:", error);

        try {
          await navigator.clipboard.writeText(cleanContent);
          return {
            success: true,
            method: "clipboard-fallback",
            message: "Email kopiert! Verwende Strg+V zum Einfügen",
          };
        } catch (clipError) {
          return {
            success: false,
            error: clipError.message,
            content: cleanContent,
          };
        }
      }
    }

    insertGmailReply(emailData, isHtml = false) {
      console.log(
        "[EmailHandler] Starting Gmail insertion process, HTML:",
        isHtml
      );

      // Click the reply button
      const replyButton =
        document.querySelector('[aria-label*="Reply"]') ||
        document.querySelector('[aria-label*="Antworten"]') ||
        document.querySelector('[data-tooltip*="Reply"]');

      if (replyButton) {
        console.log("[EmailHandler] ✓ Found reply button");
        replyButton.click();

        // Wait for compose area to appear
        setTimeout(() => {
          const composeBody =
            document.querySelector(
              'div[role="textbox"][aria-label*="Message Body"]'
            ) ||
            document.querySelector('div[role="textbox"][g_editable="true"]') ||
            document.querySelector(
              'div[contenteditable="true"][aria-label*="Nachricht"]'
            );

          if (composeBody) {
            console.log("[EmailHandler] ✓ Found compose body");

            // Clean up the email content
            let cleanedBody =
              (typeof emailData === "string"
                ? emailData
                : emailData?.body || "") ?? "";

            // Remove Subject line if it exists
            cleanedBody = cleanedBody.replace(/^Subject:.*?\n+/i, "");

            // Remove quotes if wrapped
            if (cleanedBody.startsWith('"') && cleanedBody.endsWith('"')) {
              cleanedBody = cleanedBody.slice(1, -1);
            }

            // Check if content already contains HTML tags
            const hasHtmlTags = /<[^>]+>/.test(cleanedBody);

            if (isHtml && hasHtmlTags) {
              // Content has HTML - preserve it
              console.log("[EmailHandler] Preserving HTML formatting");

              // Convert newlines to <br> but preserve existing HTML
              cleanedBody = cleanedBody.replace(/\n/g, "<br>");

              // Wrap in div for Gmail
              cleanedBody = `<div>${cleanedBody}</div>`;
            } else {
              // Original plain text handling
              console.log("[EmailHandler] Converting to Gmail HTML format");

              // Convert newlines to Gmail's div structure
              cleanedBody = cleanedBody.replace(
                /\n\n+/g,
                "</div><div><br></div><div>"
              );
              cleanedBody = cleanedBody.replace(/\n/g, "</div><div>");
              cleanedBody = "<div>" + cleanedBody + "</div>";
              cleanedBody = cleanedBody.replace(/^(<div><\/div>)+/, "");
            }

            // Set the HTML content
            composeBody.innerHTML = cleanedBody;

            // Trigger input event so Gmail recognizes the change
            composeBody.dispatchEvent(new Event("input", { bubbles: true }));

            // Visual feedback
            composeBody.style.backgroundColor = "#ffffcc";
            setTimeout(() => {
              composeBody.style.backgroundColor = "";
            }, 2000);

            console.log("[EmailHandler] ✓ Email reply insertion completed");
            return {
              success: true,
              method: isHtml ? "html-insert" : "direct-insert",
              message: "Email wurde eingefügt",
            };
          } else {
            console.error("[EmailHandler] ✗ Could not find compose body");
            return {
              success: false,
              error: "Compose body not found",
            };
          }
        }, 1000);
      } else {
        console.error("[EmailHandler] ✗ Could not find reply button");
        return {
          success: false,
          error: "Reply button not found",
        };
      }

      return { success: true, method: "initiated" };
    }
  }

  class ContentExtractor {
    constructor() {
      this.url = window.location.href;
      this.hostname = window.location.hostname;
      this.pathname = window.location.pathname;
      this.initialized = false;
      this.extractionCount = 0;
      this.lastExtraction = null;

      // Initialize EmailHandler if on email site
      this.emailHandler = null;
      this.isEmailPage = false;
      this.emailProvider = null;

      if (
        this.hostname.includes("mail.google.com") ||
        this.hostname.includes("outlook.office.com") ||
        this.hostname.includes("outlook.live.com")
      ) {
        this.emailHandler = new EmailHandler();
        this.isEmailPage = true;
        this.emailProvider = this.emailHandler.provider;
        console.log("[ContentExtractor] Email provider:", this.emailProvider);
      }

      // Handles for cleanup
      this.gmailObserver = null;
      this.docsChangeTimeout = null;
      this.docsCheckInterval = null;
      this.sharepointObserver = null;
      this.spaUrlObserver = null;

      // Site-specific configurations
      this.siteConfig = this.detectSiteConfig();

      // Initialize
      this.init();
    }

    init() {
      // Mark as loaded for detection
      window.__companyGPTExtractorLoaded = true;

      // Set up message listener
      this.setupMessageListener();

      // Initialize site-specific features
      if (this.siteConfig.type !== "generic") {
        this.initializeSiteSpecific();
      }

      this.initialized = true;
      console.log(
        `[ContentExtractor] Initialized on ${this.hostname} (type: ${this.siteConfig.type})`
      );
    }

    detectSiteConfig() {
      if (this.hostname.includes("docs.google.com")) {
        return {
          type: "google-docs",
          name: "Google Docs",
          capabilities: ["dom", "export-api"],
          selectors: {
            content: ".kix-page-content-wrapper",
            title: ".docs-title-input",
            pages: ".kix-page",
          },
        };
      } else if (this.hostname.includes("mail.google.com")) {
        return {
          type: "gmail",
          name: "Gmail",
          capabilities: ["dom", "dynamic"],
          selectors: {
            messages: 'div[role="listitem"]',
            subject: "h2[data-legacy-thread-id]",
            body: ".ii.gt .a3s.aiL",
            sender: "span[email]",
          },
        };
      } else if (
        this.hostname.includes("outlook.office.com") ||
        this.hostname.includes("outlook.live.com")
      ) {
        return {
          type: "outlook",
          name: "Outlook",
          capabilities: ["dom", "dynamic"],
          selectors: {
            messages: '[role="article"], .ReadingPaneContents',
            subject: '[role="heading"], .SubjectLine',
            body: '[role="document"], .UniqueMessageBody',
            sender: '[title*="@"], .FromLine',
          },
        };
      } else if (
        this.hostname.includes("sharepoint.com") ||
        this.hostname.includes("office.com")
      ) {
        return {
          type: "sharepoint",
          name: "SharePoint/Office",
          capabilities: ["dom", "wopi"],
          selectors: {
            content: ".od-ItemContent-title",
            canvas: "#spPageCanvasContent",
            frame: 'iframe[name="WebApplicationFrame"]',
          },
        };
      } else if (this.hostname.includes("506.ai")) {
        return {
          type: "companygpt",
          name: "CompanyGPT",
          capabilities: ["dom"],
          selectors: {
            content: "main",
            chat: ".chat-message",
          },
        };
      } else {
        return {
          type: "generic",
          name: "Generic Site",
          capabilities: ["dom"],
          selectors: {
            content: 'article, main, [role="main"], .content, #content',
            headings: "h1, h2, h3",
            paragraphs: "p",
          },
        };
      }
    }
    // In extractContent method around line 140
    async extractContent(options = {}) {
      this.extractionCount++;
      const startTime = performance.now();
      console.log(
        `[ContentExtractor] Starting extraction #${this.extractionCount}`
      );

      // Base result
      let result = {
        url: window.location.href, // Use current window URL
        title: document.title,
        hostname: this.hostname,
        siteType: this.siteConfig.type,
        timestamp: Date.now(),
        extractionNumber: this.extractionCount,
        success: false,
        content: "",
        metadata: {},
      };

      // If we're mid-login redirect (e.g., OAuth), wait briefly and then capture the final URL
      if (result.url.includes("?code=") && result.url.includes("/login/")) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        result.url = window.location.href; // Capture the post-redirect URL
      }

      try {
        // Route to appropriate extractor
        switch (this.siteConfig.type) {
          case "google-docs":
            result = { ...result, ...(await this.extractGoogleDocs()) };
            break;

          case "gmail":
          case "outlook":
            if (this.emailHandler) {
              const emailData = this.emailHandler.extract();
              const formatted = this.emailHandler.formatContent(emailData);

              result = {
                ...result,
                content: formatted,
                success: emailData.success,
                metadata: {
                  ...emailData.metadata,
                  isEmail: true,
                  isOutlook: this.siteConfig.type === "outlook",
                  isGmail: this.siteConfig.type === "gmail",
                  emailProvider: this.emailProvider,
                },
              };
            } else {
              result = { ...result, ...this.extractGeneric() };
            }
            break;

          case "sharepoint":
            result = { ...result, ...(await this.extractSharePoint()) };
            break;

          case "companygpt":
            result = { ...result, ...this.extractCompanyGPT() };
            break;

          default:
            result = { ...result, ...this.extractGeneric() };
        }

        result.success = true;
      } catch (error) {
        console.error("[ContentExtractor] Extraction error:", error);
        result.error = error?.message || String(error);
      }

      const extractionTime = performance.now() - startTime;
      result.metadata.extractionTime = extractionTime;
      console.log(
        `[ContentExtractor] Extraction completed in ${extractionTime.toFixed(
          2
        )}ms`
      );
      console.log("[ContentExtractor] Result metadata:", result.metadata);

      // Cache the result
      this.lastExtraction = result;
      return result;
    }

    async extractGoogleDocs() {
      console.log("[ContentExtractor] Extracting Google Docs content...");

      // First try DOM extraction
      const pages = document.querySelectorAll(
        this.siteConfig.selectors.content
      );
      let content = "";

      pages.forEach((page, index) => {
        const pageText = page.innerText.trim();
        if (pageText) {
          content += `\n--- Page ${index + 1} ---\n${pageText}\n`;
        }
      });

      // Get document ID for potential export
      const docId = this.pathname.match(/\/document\/d\/([^/]+)/)?.[1];

      // Check if we have enough content from DOM
      if (content.length > 100) {
        return {
          content,
          metadata: {
            method: "dom-extraction",
            pageCount: pages.length,
            docId,
            length: content.length,
          },
        };
      } else {
        // Need to use export API - signal to background script
        return {
          content: content || "Document appears empty or requires export API",
          metadata: {
            method: "dom-partial",
            needsExport: true,
            docId,
            exportUrl: docId ? `/document/d/${docId}/export?format=txt` : null,
          },
        };
      }
    }

    async extractSharePoint() {
      console.log("[ContentExtractor] Extracting SharePoint content...");

      // Check for document viewer
      const isDocumentViewer =
        this.url.includes("_layouts/15/Doc.aspx") ||
        this.url.includes("_layouts/15/WopiFrame");

      if (isDocumentViewer) {
        // Try to get document info
        const urlParams = new URLSearchParams(window.location.search);
        const sourceDoc = urlParams.get("sourcedoc");
        const fileName = document.title.replace(" - SharePoint", "").trim();

        // Check for Office Online frame
        const frame = document.querySelector(this.siteConfig.selectors.frame);

        return {
          content: `SharePoint Document: ${fileName}`,
          metadata: {
            method: "sharepoint-viewer",
            isDocument: true,
            needsApiExtraction: true,
            sourceDoc,
            fileName,
            hasFrame: !!frame,
            documentUrl: this.url,
          },
        };
      }

      // Regular SharePoint page
      const pageContent =
        document.querySelector(this.siteConfig.selectors.canvas)?.innerText ||
        document.querySelector(".od-ItemContent")?.innerText ||
        document.querySelector('[role="main"]')?.innerText ||
        "";

      return {
        content: pageContent,
        metadata: {
          method: "sharepoint-page",
          contentLength: pageContent.length,
        },
      };
    }

    extractCompanyGPT() {
      console.log("[ContentExtractor] Extracting CompanyGPT content...");

      // Extract chat messages if present
      const messages = [];
      document
        .querySelectorAll(this.siteConfig.selectors.chat)
        .forEach((msgEl) => {
          const role = msgEl.classList.contains("user") ? "user" : "assistant";
          const content = msgEl.innerText;
          messages.push({ role, content });
        });

      // Get main content
      const mainContent =
        document.querySelector(this.siteConfig.selectors.content)?.innerText ||
        "";

      return {
        content: mainContent,
        metadata: {
          method: "companygpt-extraction",
          hasChat: messages.length > 0,
          messageCount: messages.length,
          messages: messages.slice(-10),
        },
      };
    }

    async generateEmailReply(originalContext, ragResults) {
      // Get the configured sender name & signature
      const configuredSenderName = this.store?.get?.(
        "settings.emailConfig.senderName"
      );
      const emailSignature = this.store?.get?.(
        "settings.emailConfig.signature"
      );

      // Extract sender name from the original email if possible
      const emailLines = (originalContext.content || "").split("\n");
      const detectedSenderName = this.extractSenderName(emailLines);

      // Determine greeting instruction
      let greetingInstruction = "";
      if (detectedSenderName) {
        greetingInstruction = `Verwende "${detectedSenderName}" in der Anrede.`;
      } else {
        greetingInstruction =
          'Verwende eine allgemeine Anrede wie "Sehr geehrte Damen und Herren" oder "Guten Tag".';
      }

      // Determine signature instruction (signature overrides plain name if both exist)
      let signatureInstruction = "";
      if (configuredSenderName) {
        signatureInstruction = `Unterschreibe die Email mit "${configuredSenderName}".`;
      }
      if (emailSignature) {
        signatureInstruction = `Beende die Email mit folgender Signatur:\n${emailSignature}`;
      }

      const prompt = `### Rolle
  Du bist ein Experte für professionelle schriftliche Kommunikation. Deine Stärke liegt darin, gegebene Informationen in klare, präzise und freundliche E-Mail-Antworten umzuwandeln. Du agierst stets souverän, kompetent und direkt im Namen des Absenders.
  Du kommunizierst klar, professionell und direkt.

  ### Spezielle Anweisungen
  ${greetingInstruction}
  ${signatureInstruction}

  ### Aufgabe
  Deine primäre Aufgabe ist es, eine E-Mail-Anfrage eines Kunden fokussiert und präzise zu beantworten. Deine Antwort soll gezielt das Problem des Kunden lösen oder seine Frage beantworten, ohne unnötige Zusatzinformationen zu liefern.

  ### Dir bereitgestellte Informationen
  **Kunden-E-Mail:** 
  ${originalContext.content || originalContext.mainContent}

  **Wissensdatenbank-Auszug:** 
  ${ragResults}

  ### Verhaltensanweisungen & Regeln
  1. **Verinnerliche das Wissen**: Behandle die Informationen aus dem Wissensdatenbank-Auszug so, als wären es deine eigenen, langjährigen Kenntnisse. Du bist der Experte.

  2. **Verbot von Quellenangaben**: Es ist absolut entscheidend, dass du niemals erwähnst, dass du Informationen erhalten hast. Du darfst nicht auf den "Wissensdatenbank-Auszug", "die Dokumente" oder "bereitgestellte Informationen" verweisen.

  3. **Fokus und Relevanz**:
    - Identifiziere die zentrale Frage in der Kunden-E-Mail
    - Wähle aus dem Wissensdatenbank-Auszug nur die Informationen aus, die zur Beantwortung dieser spezifischen Frage absolut notwendig sind
    - Antworte so ausführlich wie nötig, aber so kurz und prägnant wie möglich
    - Dein Ziel ist es, dem Kunden schnell und effizient zu helfen, nicht, ihm dein gesamtes Wissen zu zeigen
    - Beispiel: Wenn die Wissensdatenbank 8 mögliche Fehlercodes auflistet, der Kunde aber nur nach dem Problem mit dem Dateiformat fragt, dann erwähne nur den relevanten Fehlercode (z.B. 415 - Nicht unterstützter Dateityp) und lasse die anderen 7 weg

  4. **Vermeide verräterische Phrasen**:
    FALSCH: "Die von Ihnen genannten Informationen zeigen, dass..."
    FALSCH: "Laut den Dokumenten wird WEBM nicht unterstützt."
    FALSCH: "Ich habe nachgesehen und festgestellt, dass..."
    FALSCH: "Basierend auf den vorliegenden Informationen..."
    
    RICHTIG: "Das Dateiformat WEBM wird für diesen Endpunkt leider nicht unterstützt."
    RICHTIG: "Aktuell können Sie Videos im MP4-Format hochladen."
    RICHTIG: "Der Fehlercode 415 bedeutet, dass das Dateiformat nicht unterstützt wird."

  5. **Struktur der Antwort**:
    - Verfasse eine vollständige E-Mail
    - Beginne mit einer freundlichen und passenden Anrede
    - Schreibe den Hauptteil deiner Antwort
    - Beende die E-Mail mit einer professionellen Grußformel

  ### Ausgabe
  Schreibe NUR die fertige E-Mail-Antwort. Keine Erklärungen, keine Metainformationen, keine Kommentare - nur der reine E-Mail-Text, den der Kunde erhalten soll.`;

      return await this.makeIsolatedQuery(prompt, "BASIC");
    }

    setupMessageListener() {
      // Check if chrome runtime is still valid
      if (!chrome?.runtime?.id) {
        console.warn("[ContentExtractor] Extension context lost");
        return;
      }

      // To avoid duplicate listeners on re-init, we can use a one-time flag
      if (this._listenerAttached) return;
      this._listenerAttached = true;

      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log("[ContentExtractor] Received message:", request.action);

        try {
          if (!chrome.runtime?.id) {
            console.warn(
              "[ContentExtractor] Extension context invalidated during message"
            );
            return false;
          }

          // Handle email reply insertion
          if (request.action === "INSERT_EMAIL_REPLY") {
            console.log("[ContentExtractor] INSERT_EMAIL_REPLY received");
            console.log("[ContentExtractor] Provider:", request.provider);

            const handleEmailReply = async () => {
              try {
                if (this.emailHandler && this.emailHandler.insertReply) {
                  // Use EmailHandler for insertion
                  const result = await this.emailHandler.insertReply(
                    request.data?.body || request.data
                  );
                  return result;
                } else {
                  // Fallback to clipboard
                  await navigator.clipboard.writeText(
                    request.data?.body || request.data
                  );
                  return {
                    success: true,
                    method: "clipboard",
                    message: "Copied to clipboard",
                  };
                }
              } catch (error) {
                console.error(
                  "[ContentExtractor] Error in email reply:",
                  error
                );
                return { success: false, error: error.message };
              }
            };

            handleEmailReply().then(sendResponse);
            return true; // Keep channel open for async response
          }

          // Other async actions
          const handleAsync = async () => {
            try {
              if (!chrome.runtime?.id) {
                throw new Error("Extension context invalidated");
              }

              console.log(
                `[ContentExtractor] Processing action: ${request.action}`
              );

              switch (request.action) {
                case "ping":
                  return { status: "ready", type: this.siteConfig.type };

                case "EXTRACT_CONTENT":
                  // Pass model limit to extraction
                  if (request.options?.modelLimit) {
                    this.modelLimit = request.options.modelLimit;
                  }
                  return await this.extractContent(request.options);

                default:
                  return { ok: true, note: "Unhandled action" };
              }
            } catch (error) {
              console.error("[ContentExtractor] Error:", error);
              return { error: error.message };
            }
          };

          handleAsync()
            .then((result) => {
              if (chrome.runtime?.id) {
                sendResponse(result);
              }
            })
            .catch((error) => {
              console.error("[ContentExtractor] Async handler error:", error);
              if (chrome.runtime?.id) {
                sendResponse({ error: error.message });
              }
            });

          return true; // Keep channel open for async response
        } catch (error) {
          console.error("[ContentExtractor] Message handler error:", error);
          if (chrome.runtime?.id) {
            sendResponse({ error: "Extension context error" });
          }
          return false;
        }
      });
    }

    initializeSiteSpecific() {
      switch (this.siteConfig.type) {
        case "gmail":
          this.initGmailObserver();
          break;
        case "outlook":
          this.initOutlookObserver();
          break;
        case "google-docs":
          this.initDocsObserver();
          break;
        case "sharepoint":
          this.initSharePointObserver();
          break;
      }
    }

    initGmailObserver() {
      // Watch for new emails being loaded
      const observer = new MutationObserver((mutations) => {
        // Check if new messages appeared
        const hasNewMessages = mutations.some((mutation) => {
          return Array.from(mutation.addedNodes).some((node) => {
            return (
              node.nodeType === 1 &&
              (node.matches?.('[role="listitem"]') ||
                node.querySelector?.('[role="listitem"]'))
            );
          });
        });

        if (hasNewMessages) {
          console.log("[ContentExtractor] New Gmail messages detected");
          // Could notify extension that new content is available
          try {
            chrome.runtime
              .sendMessage({
                type: "CONTENT_UPDATED",
                siteType: "gmail",
                url: this.url,
              })
              .catch(() => {});
          } catch (_) {}
        }
      });

      const container = document.querySelector(".AO, [role='main']");
      if (container) {
        observer.observe(container, {
          childList: true,
          subtree: true,
        });
        this.gmailObserver = observer;
        console.log("[ContentExtractor] Gmail observer initialized");
      }
    }

    initOutlookObserver() {
      const container =
        document.querySelector('[role="main"]') ||
        document.querySelector(".ReadingPaneContents") ||
        document.body;

      if (!container) return;

      const observer = new MutationObserver((mutations) => {
        const hasReadingPaneChange = mutations.some((m) =>
          Array.from(m.addedNodes).some(
            (n) =>
              n.nodeType === 1 &&
              (n.matches?.(".ReadingPaneContents, [role='article']") ||
                n.querySelector?.(".ReadingPaneContents, [role='article']"))
          )
        );

        if (hasReadingPaneChange) {
          console.log("[ContentExtractor] Outlook reading pane updated");
          try {
            chrome.runtime
              .sendMessage({
                type: "CONTENT_UPDATED",
                siteType: "outlook",
                url: this.url,
              })
              .catch(() => {});
          } catch (_) {}
        }
      });

      observer.observe(container, { childList: true, subtree: true });
      this.gmailObserver = observer; // reuse handle for cleanup
      console.log("[ContentExtractor] Outlook observer initialized");
    }

    initDocsObserver() {
      // Watch for document changes
      let lastContent = "";
      const checkForChanges = () => {
        const currentContent =
          document.querySelector(".kix-page")?.innerText || "";
        if (currentContent !== lastContent) {
          lastContent = currentContent;
          console.log("[ContentExtractor] Google Docs content changed");

          // Debounced notification
          clearTimeout(this.docsChangeTimeout);
          this.docsChangeTimeout = setTimeout(() => {
            try {
              chrome.runtime
                .sendMessage({
                  type: "CONTENT_UPDATED",
                  siteType: "google-docs",
                  url: this.url,
                })
                .catch(() => {});
            } catch (_) {}
          }, 1000);
        }
      };

      // Check periodically (Google Docs doesn't trigger mutations reliably)
      this.docsCheckInterval = setInterval(checkForChanges, 5000);
    }

    initSharePointObserver() {
      // Watch for SharePoint dynamic content loading
      const observer = new MutationObserver((mutations) => {
        const hasNewContent = mutations.some((mutation) => {
          return (
            mutation.target.id === "spPageCanvasContent" ||
            mutation.target.classList?.contains("od-ItemContent")
          );
        });

        if (hasNewContent) {
          console.log("[ContentExtractor] SharePoint content updated");
        }
      });

      const container = document.querySelector(
        "#spPageCanvasContent, .od-ItemContent"
      );
      if (container) {
        observer.observe(container, {
          childList: true,
          subtree: true,
        });
        this.sharepointObserver = observer;
      }
    }

    cleanup() {
      console.log("[ContentExtractor] Cleaning up...");

      // Clear observers
      if (this.gmailObserver) {
        try {
          this.gmailObserver.disconnect();
        } catch (_) {}
        this.gmailObserver = null;
      }

      if (this.sharepointObserver) {
        try {
          this.sharepointObserver.disconnect();
        } catch (_) {}
        this.sharepointObserver = null;
      }

      // Clear timeouts
      if (this.docsChangeTimeout) {
        try {
          clearTimeout(this.docsChangeTimeout);
        } catch (_) {}
        this.docsChangeTimeout = null;
      }

      // Clear intervals
      if (this.docsCheckInterval) {
        try {
          clearInterval(this.docsCheckInterval);
        } catch (_) {}
        this.docsCheckInterval = null;
      }

      // Disconnect SPA URL observer
      if (this.spaUrlObserver) {
        try {
          this.spaUrlObserver.disconnect();
        } catch (_) {}
        this.spaUrlObserver = null;
      }

      this.initialized = false;
      console.log("[ContentExtractor] Cleanup complete");
    }
  }

  // Initialize the extractor
  let contentExtractor = null;

  function initializeExtractor() {
    if (contentExtractor) {
      console.log("[ContentExtractor] Already initialized");
      return;
    }

    contentExtractor = new ContentExtractor();

    // Handle SPA navigation
    let lastUrl = location.href;
    const spaObserver = new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        console.log("[ContentExtractor] URL changed, reinitializing...");

        // Cleanup existing instance before replacing
        if (contentExtractor?.cleanup) {
          contentExtractor.cleanup();
        }

        contentExtractor = new ContentExtractor();
        window.__companyGPTExtractor = contentExtractor;
      }
    });

    spaObserver.observe(document, { subtree: true, childList: true });

    // keep a ref for cleanup
    contentExtractor.spaUrlObserver = spaObserver;

    // Store the instance globally
    window.__companyGPTExtractor = contentExtractor;
  }

  // Initialize based on document state
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeExtractor, {
      once: true,
    });
  } else {
    initializeExtractor();
  }

  window.__companyGPTExtractorLoaded = true;
  console.log("[CompanyGPT Extension] Content script loaded");
})(); // End of IIFE
