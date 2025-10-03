// shared/models-config.js
console.log("[ModelsConfig] Loading models-config.js file..."); // ADD THIS LINE

(function () {
  "use strict";

  console.log("[ModelsConfig] Inside IIFE, defining models..."); // ADD THIS LINE
  // Model definitions matching 506.ai backend exactly
  const AVAILABLE_MODELS = Object.freeze([
    {
      id: "gpt-4o",
      name: "GPT-4 Omni",
      maxLength: 90000,
      tokenLimit: 110000,
      provider: "openai",
    },
    {
      id: "gpt-4.1-mini",
      name: "GPT-4.1 Mini",
      maxLength: 90000,
      tokenLimit: 500000,
      provider: "openai",
    },
    {
      id: "o3-mini",
      name: "o3 Mini",
      maxLength: 195000,
      tokenLimit: 195000,
      provider: "openai",
    },
    {
      id: "claude-3-5-sonnet-20240620-v1:0",
      name: "Claude Sonnet 3.5",
      maxLength: 190000,
      tokenLimit: 190000,
      provider: "anthropic",
    },
    {
      id: "claude-3-7-sonnet-20250219-v1:0",
      name: "Claude Sonnet 3.7",
      maxLength: 190000,
      tokenLimit: 190000,
      provider: "anthropic",
    },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      maxLength: 980000,
      tokenLimit: 980000,
      provider: "google",
    },
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      maxLength: 980000,
      tokenLimit: 980000,
      provider: "google",
      isDefault: true, // Current default
    },
  ]);

  // Helper functions
  const ModelsConfig = {
    // Get all available models
    getAll() {
      return AVAILABLE_MODELS;
    },

    // Get model by ID
    getById(modelId) {
      return AVAILABLE_MODELS.find((m) => m.id === modelId);
    },

    // Get default model
    getDefault() {
      return AVAILABLE_MODELS.find((m) => m.isDefault) || AVAILABLE_MODELS[6]; // Gemini Flash
    },

    // Get model display name
    getDisplayName(modelId) {
      const model = this.getById(modelId);
      return model ? model.name : modelId;
    },

    // Validate if model ID exists
    isValidModel(modelId) {
      return AVAILABLE_MODELS.some((m) => m.id === modelId);
    },
  };

  // Expose globally
  window.ModelsConfig = Object.freeze(ModelsConfig);
})();
