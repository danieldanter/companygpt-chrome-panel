// sidepanel/modules/datenspeicher-selector.js
import { debounce } from "./utils.js";
export class DatenspeicherSelector {
  constructor(store) {
    this.store = store;
    this.folders = [];
    this.selectedFolder = null; // Single selection
    this.dropdownElement = null;
    this.isOpen = false;

    // Debounced search: waits 300ms after typing stops
    this.debouncedSearch = debounce((searchTerm) => {
      this.performSearch(searchTerm);
    }, 300);

    // Initialize
    this.init();
  }

  async init() {
    console.log("[DatenspeicherSelector] Initializing...");

    this.createDropdownElement();

    // Only try to load if we might be authenticated
    try {
      const isAuth = await window.APIService.checkAuth();
      if (isAuth) {
        await this.loadFolders();
      } else {
        console.log(
          "[DatenspeicherSelector] Not authenticated on init, skipping load"
        );
      }
    } catch (error) {
      console.log("[DatenspeicherSelector] Init load skipped:", error.message);
    }

    this.restoreLastSelection();
  }

  /**
   * Restore last selected Datenspeicher from store
   */
  restoreLastSelection() {
    const lastSelectedId = this.store.get("datenspeicher.lastSelected");
    const lastSelectedName = this.store.get("datenspeicher.lastSelectedName");

    if (lastSelectedId && lastSelectedName) {
      this.selectedFolder = { id: lastSelectedId, name: lastSelectedName };
      this.updateButtonText(lastSelectedName);
      console.log(
        "[DatenspeicherSelector] Restored last selection:",
        lastSelectedName
      );
    }
  }

  /**
   * Create the dropdown UI element
   */
  createDropdownElement() {
    // Check if already exists
    const existing = document.getElementById("datenspeicher-dropdown");
    if (existing) {
      this.dropdownElement = existing;
      return;
    }

    // Create dropdown container
    const dropdown = document.createElement("div");
    dropdown.id = "datenspeicher-dropdown";
    dropdown.className = "datenspeicher-dropdown";
    dropdown.style.display = "none";
    dropdown.innerHTML = `
      <div class="dropdown-header">
        <span class="dropdown-title">Datenspeicher auswählen</span>
        <div class="dropdown-header-actions">
          <button class="dropdown-refresh" id="dropdown-refresh" title="Aktualisieren">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"></path>
            </svg>
          </button>
          <button class="dropdown-close" id="dropdown-close">✕</button>
        </div>
      </div>
      <div class="dropdown-search">
        <input type="text"
               id="datenspeicher-search"
               placeholder="Suche Datenspeicher..."
               class="dropdown-search-input">
      </div>
      <div class="dropdown-list" id="datenspeicher-list">
        <div class="dropdown-loading">Lade Datenspeicher...</div>
      </div>
    `;

    // Add to context actions area (near the button)
    const contextBar = document.getElementById("context-bar");
    if (contextBar) {
      contextBar.appendChild(dropdown);
    } else {
      document.body.appendChild(dropdown);
    }

    this.dropdownElement = dropdown;

    // Setup event listeners
    this.setupDropdownListeners();
  }

  setupDropdownListeners() {
    // Close button
    document.getElementById("dropdown-close")?.addEventListener("click", () => {
      this.close();
    });

    // Refresh button
    document
      .getElementById("dropdown-refresh")
      ?.addEventListener("click", async () => {
        console.log("[DatenspeicherSelector] Manual refresh triggered");

        // Show loading state
        const listElement = document.getElementById("datenspeicher-list");
        if (listElement) {
          listElement.innerHTML =
            '<div class="dropdown-loading">Aktualisiere...</div>';
        }

        // Force refresh from API
        await this.loadFolders(true);

        // Re-render
        this.renderFolders();
      });

    // Search input with debouncing
    document
      .getElementById("datenspeicher-search")
      ?.addEventListener("input", (e) => {
        const searchTerm = e.target.value;

        // Show loading state immediately while typing
        this.showSearching();

        // Perform actual search after debounce
        this.debouncedSearch(searchTerm);
      });

    // Click outside to close
    document.addEventListener("click", (e) => {
      if (
        this.isOpen &&
        this.dropdownElement &&
        !this.dropdownElement.contains(e.target) &&
        !e.target.closest('.context-action-btn[data-action="reply-with-data"]')
      ) {
        this.close();
      }
    });
  }

  showSearching() {
    const listElement = document.getElementById("datenspeicher-list");
    if (listElement && !listElement.querySelector(".searching")) {
      const searchingEl = document.createElement("div");
      searchingEl.className = "searching";
      searchingEl.textContent = "Suche...";
      listElement.prepend(searchingEl);
    }
  }

  performSearch(searchTerm) {
    // Remove searching indicator
    const searchingEl = document.querySelector(".searching");
    if (searchingEl) searchingEl.remove();

    // Perform actual filter
    this.filterFolders(searchTerm);
  }

  /**
   * Load folders from API or cache
   */
  // In datenspeicher-selector.js, replace the loadFolders method:

  async loadFolders(forceRefresh = false) {
    try {
      // Check cache first (existing code)
      if (!forceRefresh) {
        const cachedFolders = this.store.get("datenspeicher.available");
        const cacheTime = this.store.get("datenspeicher.cacheTime");

        if (cachedFolders && cachedFolders.length > 0 && cacheTime) {
          const cacheAge = Date.now() - cacheTime;
          const tenMinutes = 10 * 60 * 1000;

          if (cacheAge < tenMinutes) {
            console.log(`[DatenspeicherSelector] Using cached folders`);
            this.folders = cachedFolders;
            if (this.isOpen) this.renderFolders();
            return;
          }
        }
      }

      // Check if authenticated first
      const isAuth = await window.APIService.checkAuth();
      if (!isAuth) {
        console.log("[DatenspeicherSelector] Not authenticated, using cache");
        const cachedFolders = this.store.get("datenspeicher.available");
        if (cachedFolders) {
          this.folders = cachedFolders;
          if (this.isOpen) this.renderFolders();
        }
        return;
      }

      console.log("[DatenspeicherSelector] Loading folders via APIService");

      // USE THE APISERVICE!
      const response = await window.APIService.fetchFolders();

      // Make sure we have an array
      const allFolders = response?.folders || response || [];

      // Only filter if it's actually an array
      if (Array.isArray(allFolders)) {
        this.folders = allFolders.filter((f) => f.type === "MEDIA") || [];
      } else {
        console.error(
          "[DatenspeicherSelector] Invalid folders response:",
          response
        );
        this.folders = [];
      }

      console.log(
        `[DatenspeicherSelector] Loaded ${this.folders.length} MEDIA folders`
      );

      // Cache them
      this.store.set("datenspeicher.available", this.folders);
      this.store.set("datenspeicher.cacheTime", Date.now());

      if (this.isOpen) this.renderFolders();
    } catch (error) {
      console.error("[DatenspeicherSelector] Failed to load folders:", error);

      // Use cache as fallback
      const cachedFolders = this.store.get("datenspeicher.available");
      if (cachedFolders && cachedFolders.length > 0) {
        console.log("[DatenspeicherSelector] Using cached folders as fallback");
        this.folders = cachedFolders;
        if (this.isOpen) this.renderFolders();
      } else {
        console.log("[DatenspeicherSelector] No folders available");
        this.folders = [];
      }
    }
  }

  /**
   * Render folders in the dropdown
   */
  renderFolders(filteredFolders = null) {
    const listElement = document.getElementById("datenspeicher-list");
    if (!listElement) return;

    const foldersToShow = filteredFolders || this.folders;

    if (foldersToShow.length === 0) {
      listElement.innerHTML = `
        <div class="dropdown-empty">
          ${
            filteredFolders
              ? "Keine Datenspeicher gefunden"
              : "Keine Datenspeicher verfügbar"
          }
        </div>
      `;
      return;
    }

    listElement.innerHTML = foldersToShow
      .map(
        (folder) => `
      <div class="dropdown-item ${
        this.selectedFolder?.id === folder.id ? "selected" : ""
      }" 
           data-folder-id="${folder.id}"
           data-folder-name="${this.escapeHtml(folder.name)}">
        <div class="dropdown-item-content">
          <span class="folder-name">${this.escapeHtml(folder.name)}</span>
          ${folder.shared ? '<span class="folder-badge">Geteilt</span>' : ""}
          ${
            this.selectedFolder?.id === folder.id
              ? '<span class="folder-selected">✓</span>'
              : ""
          }
        </div>
      </div>
    `
      )
      .join("");

    // Add click listeners to items
    listElement.querySelectorAll(".dropdown-item").forEach((item) => {
      item.addEventListener("click", () => {
        const folderId = item.dataset.folderId;
        const folderName = item.dataset.folderName;
        this.selectFolder(folderId, folderName);
      });
    });
  }

  /**
   * Select a folder (single selection)
   */
  // Update the selectFolder method
  selectFolder(folderId, folderName) {
    console.log("[DatenspeicherSelector] Selected folder:", folderName);

    // Update selection
    this.selectedFolder = { id: folderId, name: folderName };

    // Store in state
    this.store.set("datenspeicher.lastSelected", folderId);
    this.store.set("datenspeicher.lastSelectedName", folderName);

    // Update button to show selection
    this.updateButtonWithSelection(folderName);

    // Close dropdown
    this.close();

    // Emit event
    window.dispatchEvent(
      new CustomEvent("datenspeicher-selected", {
        detail: {
          folderId: folderId,
          folderName: folderName,
          folder: this.folders.find((f) => f.id === folderId),
        },
      })
    );
  }
  // New method to update button with selection
  updateButtonWithSelection(folderName) {
    const button = document.querySelector(
      '.context-action-btn[data-action="reply-with-data"]'
    );
    if (!button) return;

    // Add has-selection class
    button.classList.add("has-selection");

    // Update the label text
    const labelSpan = button.querySelector(".button-label");
    if (labelSpan) {
      // Truncate long names
      const maxLength = 20;
      const truncatedName =
        folderName.length > maxLength
          ? folderName.substring(0, maxLength) + "..."
          : folderName;

      labelSpan.textContent = `Mit "${truncatedName}" antworten`;
      labelSpan.title = `Mit "${folderName}" antworten`; // Full name in tooltip
    }
  }

  // Add method to clear selection from button
  clearButtonSelection() {
    const button = document.querySelector(
      '.context-action-btn[data-action="reply-with-data"]'
    );
    if (!button) return;

    // Remove has-selection class
    button.classList.remove("has-selection");

    // Reset label text
    const labelSpan = button.querySelector(".button-label");
    if (labelSpan) {
      labelSpan.textContent = "Mit Datenspeicher antworten";
      labelSpan.removeAttribute("title");
    }
  }
  // New method to update button with selection
  updateButtonWithSelection(folderName) {
    const button = document.querySelector(
      '.context-action-btn[data-action="reply-with-data"]'
    );
    if (!button) return;

    // Add has-selection class
    button.classList.add("has-selection");

    // Update the label text
    const labelSpan = button.querySelector(".button-label");
    if (labelSpan) {
      // Truncate long names
      const maxLength = 20;
      const truncatedName =
        folderName.length > maxLength
          ? folderName.substring(0, maxLength) + "..."
          : folderName;

      labelSpan.textContent = `Mit "${truncatedName}" antworten`;
      labelSpan.title = `Mit "${folderName}" antworten`; // Full name in tooltip
    }
  }

  // Add method to clear selection from button
  clearButtonSelection() {
    const button = document.querySelector(
      '.context-action-btn[data-action="reply-with-data"]'
    );
    if (!button) return;

    // Remove has-selection class
    button.classList.remove("has-selection");

    // Reset label text
    const labelSpan = button.querySelector(".button-label");
    if (labelSpan) {
      labelSpan.textContent = "Mit Datenspeicher antworten";
      labelSpan.removeAttribute("title");
    }
  }

  // Update clearSelection method
  clearSelection() {
    this.selectedFolder = null;
    this.store.set("datenspeicher.lastSelected", null);
    this.store.set("datenspeicher.lastSelectedName", null);

    // Reset button appearance
    this.clearButtonSelection();
  }

  // Update restoreLastSelection method
  restoreLastSelection() {
    const lastSelectedId = this.store.get("datenspeicher.lastSelected");
    const lastSelectedName = this.store.get("datenspeicher.lastSelectedName");

    if (lastSelectedId && lastSelectedName) {
      this.selectedFolder = { id: lastSelectedId, name: lastSelectedName };
      this.updateButtonWithSelection(lastSelectedName);
      console.log(
        "[DatenspeicherSelector] Restored last selection:",
        lastSelectedName
      );
    }
  }

  /**
   * Update the button text with selected Datenspeicher name
   */
  updateButtonText(folderName) {
    const labelSpan = document.querySelector(
      '.context-action-btn[data-action="reply-with-data"] span'
    );
    if (labelSpan) {
      // Truncate long names
      const maxLength = 20;
      const truncatedName =
        folderName.length > maxLength
          ? folderName.substring(0, maxLength) + "..."
          : folderName;

      labelSpan.textContent = `Mit "${truncatedName}" antworten`;
    }
  }

  /**
   * Filter folders by search term
   */
  filterFolders(searchTerm) {
    const term = (searchTerm || "").toLowerCase().trim();

    if (!term) {
      this.renderFolders();
      return;
    }

    const filtered = this.folders.filter((folder) =>
      folder.name.toLowerCase().includes(term)
    );

    this.renderFolders(filtered);
  }

  /**
   * Open the dropdown
   */
  async open() {
    if (this.isOpen) return;

    console.log("[DatenspeicherSelector] Opening dropdown");

    // Load folders (will use cache if available and fresh)
    await this.loadFolders();

    // Restore the last selection from store
    const lastSelectedId = this.store.get("datenspeicher.lastSelected");
    const lastSelectedName = this.store.get("datenspeicher.lastSelectedName");

    if (lastSelectedId && lastSelectedName) {
      this.selectedFolder = { id: lastSelectedId, name: lastSelectedName };
      console.log(
        "[DatenspeicherSelector] Restored selection in dropdown:",
        lastSelectedName
      );
    }

    // Position dropdown above the button (dropup style) with better edge handling
    const button = document.querySelector(
      '.context-action-btn[data-action="reply-with-data"]'
    );
    if (button && this.dropdownElement) {
      const rect = button.getBoundingClientRect();
      const dropdownWidth = 280;
      const viewportWidth = window.innerWidth;

      // Calculate left position - ensure it doesn't go off-screen
      let leftPos = rect.left;

      // If dropdown would go off right edge, align it to the right edge of button
      if (leftPos + dropdownWidth > viewportWidth) {
        leftPos = rect.right - dropdownWidth;
      }

      // If still off-screen (button is very far right), align to viewport edge
      if (leftPos + dropdownWidth > viewportWidth) {
        leftPos = viewportWidth - dropdownWidth - 10; // 10px margin from edge
      }

      // Ensure it doesn't go off left edge either
      if (leftPos < 10) {
        leftPos = 10;
      }

      this.dropdownElement.style.position = "fixed";
      this.dropdownElement.style.bottom = `${
        window.innerHeight - rect.top + 5
      }px`;
      this.dropdownElement.style.left = `${leftPos}px`;
      this.dropdownElement.style.width = `${dropdownWidth}px`;
      this.dropdownElement.style.maxHeight = "350px";
    }

    // Show dropdown
    this.dropdownElement.style.display = "block";
    this.isOpen = true;

    // Render folders
    this.renderFolders();

    // Focus search input
    setTimeout(() => {
      document.getElementById("datenspeicher-search")?.focus();
    }, 100);
  }
  /**
   * Close the dropdown
   */
  close() {
    if (!this.isOpen) return;

    console.log("[DatenspeicherSelector] Closing dropdown");

    if (this.dropdownElement) {
      this.dropdownElement.style.display = "none";
    }
    this.isOpen = false;

    // Clear search
    const searchInput = document.getElementById("datenspeicher-search");
    if (searchInput) {
      searchInput.value = "";
    }
  }

  /**
   * Get selected folder
   */
  getSelectedFolder() {
    return this.selectedFolder;
  }

  /**
   * Clear selection
   */
  clearSelection() {
    this.selectedFolder = null;
    this.store.set("datenspeicher.lastSelected", null);
    this.store.set("datenspeicher.lastSelectedName", null);

    // Reset button text
    const labelSpan = document.querySelector(
      '.context-action-btn[data-action="reply-with-data"] span'
    );
    if (labelSpan) {
      labelSpan.textContent = "Mit Datenspeicher antworten";
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    const listElement = document.getElementById("datenspeicher-list");
    if (listElement) {
      listElement.innerHTML = `
        <div class="dropdown-error">
          ⚠️ ${this.escapeHtml(message)}
        </div>
      `;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text ?? "");
    return div.innerHTML;
  }
}
