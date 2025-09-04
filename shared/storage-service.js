// popup/services/storage-service.js
// Chrome storage management service (MV3-safe)
/* eslint-disable no-undef */
(function () {
  "use strict";

  // Toggle verbose logs for development (true locally; false for store)
  const DEBUG = false;
  const debug = (...args) => {
    if (DEBUG) console.log(...args);
  };

  // --- Low-level wrappers with ChromeAPI fallbacks --------------------------

  const getStorage = (keys) => {
    if (window.ChromeAPI?.getStorage) {
      return window.ChromeAPI.getStorage(keys);
    }
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  };

  const setStorage = (items) => {
    if (window.ChromeAPI?.setStorage) {
      return window.ChromeAPI.setStorage(items);
    }
    return new Promise((resolve) => {
      chrome.storage.local.set(items, resolve);
    });
  };

  const removeStorage = (keys) => {
    if (window.ChromeAPI?.removeStorage) {
      return window.ChromeAPI.removeStorage(keys);
    }
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, resolve);
    });
  };

  const clearStorage = () => {
    if (window.ChromeAPI?.clearStorage) {
      return window.ChromeAPI.clearStorage();
    }
    return new Promise((resolve) => {
      chrome.storage.local.clear(resolve);
    });
  };

  // --- Keys -----------------------------------------------------------------

  const STORAGE_KEYS = {
    MICROPHONE_PERMISSION: "microphonePermission",
    SELECTED_FOLDER: "selectedFolder",
    FOLDERS_CACHE: "foldersCache",
    LAST_FILENAME: "lastFilename",
    APP_STATE: "appState",
    USER_PREFERENCES: "userPreferences",
  };

  // --- Microphone permission ------------------------------------------------

  async function saveMicrophonePermission(state) {
    await setStorage({
      [STORAGE_KEYS.MICROPHONE_PERMISSION]: {
        ...state,
        lastUpdated: Date.now(),
      },
    });
  }

  async function getMicrophonePermission() {
    const data = await getStorage(STORAGE_KEYS.MICROPHONE_PERMISSION);
    return (
      data[STORAGE_KEYS.MICROPHONE_PERMISSION] || {
        hasSeenExplanation: false,
        userAccepted: false,
        lastRequestDate: null,
        deniedCount: 0,
        neverAskAgain: false,
      }
    );
  }

  // --- Folder selection & cache --------------------------------------------

  async function saveSelectedFolder(folderId, folderName) {
    await setStorage({
      [STORAGE_KEYS.SELECTED_FOLDER]: {
        id: folderId,
        name: folderName,
        timestamp: Date.now(),
      },
    });
  }

  async function getSelectedFolder() {
    const data = await getStorage(STORAGE_KEYS.SELECTED_FOLDER);
    return data[STORAGE_KEYS.SELECTED_FOLDER] || null;
  }

  async function cacheFolders(folders) {
    await setStorage({
      [STORAGE_KEYS.FOLDERS_CACHE]: {
        folders,
        cachedAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      },
    });
  }

  async function getCachedFolders() {
    const data = await getStorage(STORAGE_KEYS.FOLDERS_CACHE);
    const cache = data[STORAGE_KEYS.FOLDERS_CACHE];
    if (!cache) return null;

    if (Date.now() > cache.expiresAt) {
      await removeStorage(STORAGE_KEYS.FOLDERS_CACHE);
      return null;
    }
    return cache.folders;
  }

  // --- Filenames ------------------------------------------------------------

  async function saveLastFilename(filename) {
    await setStorage({
      [STORAGE_KEYS.LAST_FILENAME]: { filename, timestamp: Date.now() },
    });
  }

  async function getLastFilename() {
    const data = await getStorage(STORAGE_KEYS.LAST_FILENAME);
    return data[STORAGE_KEYS.LAST_FILENAME]?.filename || null;
  }

  // --- Preferences ----------------------------------------------------------

  async function savePreferences(preferences) {
    const current = await getPreferences();
    await setStorage({
      [STORAGE_KEYS.USER_PREFERENCES]: {
        ...current,
        ...preferences,
        lastUpdated: Date.now(),
      },
    });
  }

  async function getPreferences() {
    const data = await getStorage(STORAGE_KEYS.USER_PREFERENCES);
    return (
      data[STORAGE_KEYS.USER_PREFERENCES] || {
        autoGenerateFilename: true,
        defaultTab: "audio",
        showNotifications: true,
        recordingQuality: "high",
        theme: "light",
      }
    );
  }

  // --- App state snapshot ---------------------------------------------------

  async function saveAppState(state) {
    const stateToSave = {
      ui: {
        activeTab: state.ui?.activeTab,
        selectedFolderId: state.ui?.selectedFolderId,
        selectedFolderName: state.ui?.selectedFolderName,
      },
      permissions: state.permissions,
    };

    await setStorage({
      [STORAGE_KEYS.APP_STATE]: { ...stateToSave, savedAt: Date.now() },
    });
  }

  async function loadAppState() {
    const data = await getStorage(STORAGE_KEYS.APP_STATE);
    return data[STORAGE_KEYS.APP_STATE] || null;
  }

  // --- Clearing helpers -----------------------------------------------------

  async function clearAllData() {
    await clearStorage();
    debug("[StorageService] All data cleared");
  }

  /**
   * Clear specific categories of stored data.
   * @param {Array<"permissions"|"folders"|"preferences"|"state">} types
   */
  async function clearData(types = []) {
    const keysToRemove = types
      .map((type) => {
        switch (type) {
          case "permissions":
            return STORAGE_KEYS.MICROPHONE_PERMISSION;
          case "folders":
            return [STORAGE_KEYS.SELECTED_FOLDER, STORAGE_KEYS.FOLDERS_CACHE];
          case "preferences":
            return STORAGE_KEYS.USER_PREFERENCES;
          case "state":
            return STORAGE_KEYS.APP_STATE;
          default:
            return null;
        }
      })
      .flat()
      .filter(Boolean);

    if (keysToRemove.length > 0) {
      await removeStorage(keysToRemove);
      debug("[StorageService] Cleared:", keysToRemove);
    }
  }

  // --- Diagnostics ----------------------------------------------------------

  async function getStorageInfo() {
    // Passing null to chrome.storage.local.get returns all items
    const data = await getStorage(null);
    const size = new Blob([JSON.stringify(data)]).size;
    return {
      sizeInBytes: size,
      sizeFormatted: formatBytes(size),
      keys: Object.keys(data),
      itemCount: Object.keys(data).length,
    };
  }

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${
      sizes[i]
    }`;
  }

  // --- Public API -----------------------------------------------------------

  window.StorageService = {
    saveMicrophonePermission,
    getMicrophonePermission,
    saveSelectedFolder,
    getSelectedFolder,
    cacheFolders,
    getCachedFolders,
    saveLastFilename,
    getLastFilename,
    savePreferences,
    getPreferences,
    saveAppState,
    loadAppState,
    clearAllData,
    clearData,
    getStorageInfo,
  };
})(); // End IIFE
