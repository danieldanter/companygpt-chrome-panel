// sidepanel/modules/audio-recorder.js
import { debounce } from "./utils.js";

export class AudioRecorder {
  constructor(store) {
    this.store = store;

    // Recording state
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.audioBlob = null;
    this.audioUrl = null;
    this.startTime = null;
    this.timerInterval = null;

    // Settings
    this.MAX_DURATION = 2 * 60 * 60 * 1000; // 2 hours in ms
    this.CHUNK_SIZE = 1024 * 1024; // 1MB chunks for memory efficiency

    // UI elements (will be set by init)
    this.elements = {};

    // Bind methods
    this.handleDataAvailable = this.handleDataAvailable.bind(this);
    this.handleStop = this.handleStop.bind(this);
    this.updateTimer = this.updateTimer.bind(this);
  }

  /**
   * Initialize the recorder with UI elements
   */
  init(elements) {
    this.elements = {
      recordButton: elements.recordButton,
      timerDisplay: elements.timerDisplay,
      playbackControls: elements.playbackControls,
      audioPlayer: elements.audioPlayer,
      uploadButton: elements.uploadButton,
      filenameInput: elements.filenameInput,
    };

    // Set initial state
    this.updateUI("idle");

    console.log("[AudioRecorder] Initialized");
  }

  /**
   * Check and request microphone permission
   */
  // In audio-recorder.js, update checkPermission:

  async checkPermission() {
    try {
      console.log("[AudioRecorder] Requesting microphone permission...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      stream.getTracks().forEach((track) => track.stop());
      console.log("[AudioRecorder] Microphone permission granted");
      return true;
    } catch (error) {
      console.error("[AudioRecorder] Microphone permission error:", error);

      // Update the UI to show permission instructions
      if (this.elements.recordButton) {
        this.elements.recordButton.innerHTML = `
        <div style="text-align: center; padding: 10px;">
          <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">
            Mikrofonzugriff benötigt
          </div>
          <div style="font-size: 10px; opacity: 0.8; line-height: 1.4;">
            1. Klicke auf 🔒 in der Adressleiste<br>
            2. Erlaube Mikrofon<br>
            3. Lade die Seite neu
          </div>
        </div>
      `;
        this.elements.recordButton.style.background = "#ff9800";
        this.elements.recordButton.style.height = "auto";
      }

      return false;
    }
  }

  /**
   * Start recording
   */

  async startRecording() {
    console.log("[AudioRecorder] Starting recording...");

    // Check permission first
    const hasPermission = await this.checkPermission();
    if (!hasPermission) {
      // Show permission help UI
      this.showPermissionHelp();
      return false;
    }

    try {
      // Get audio stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });

      // Create MediaRecorder with WebM format (Chrome default)
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 128000,
      });

      // Reset chunks
      this.audioChunks = [];

      // Set up event handlers
      this.mediaRecorder.ondataavailable = this.handleDataAvailable;
      this.mediaRecorder.onstop = this.handleStop;

      // Start recording with 1 second chunks (for regular data saving)
      this.mediaRecorder.start(1000);

      // Start timer
      this.startTime = Date.now();
      this.startTimer();

      // Update UI
      this.updateUI("recording");

      // Set maximum duration timeout
      this.maxDurationTimeout = setTimeout(() => {
        console.log("[AudioRecorder] Max duration reached, stopping...");
        this.stopRecording();
      }, this.MAX_DURATION);

      // Update store
      this.store.set("upload.recording.isRecording", true);
      this.store.set("upload.recording.startTime", this.startTime);

      console.log("[AudioRecorder] Recording started");
      return true;
    } catch (error) {
      console.error("[AudioRecorder] Failed to start recording:", error);
      this.store.actions.showError(
        "Fehler beim Starten der Aufnahme: " + error.message
      );
      return false;
    }
  }

  showPermissionHelp() {
    // Update the record button to show permission needed
    if (this.elements?.recordButton) {
      this.elements.recordButton.innerHTML = `
        <div class="permission-needed">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <span class="permission-text">Mikrofonzugriff benötigt</span>
            <span class="permission-hint">Klicke auf das Schloss-Symbol in der Adressleiste</span>
        </div>
        `;
      this.elements.recordButton.classList.add("permission-required");
    }

    // Optional: browser-specific tips
    const isChrome =
      /Chrome/.test(navigator.userAgent) &&
      /Google Inc/.test(navigator.vendor || "");
    if (isChrome) {
      console.log("[AudioRecorder] Show Chrome permission instructions");
      // Example (commented out): open microphone settings in a new tab
      // chrome.tabs?.create?.({ url: "chrome://settings/content/microphone" });
    }
  }

  /**
   * Stop recording
   */
  stopRecording() {
    console.log("[AudioRecorder] Stopping recording...");

    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
      console.warn("[AudioRecorder] Not recording");
      return;
    }

    // Stop the recorder
    this.mediaRecorder.stop();

    // Stop all tracks
    this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());

    // Clear max duration timeout
    if (this.maxDurationTimeout) {
      clearTimeout(this.maxDurationTimeout);
      this.maxDurationTimeout = null;
    }

    // Stop timer
    this.stopTimer();

    // Update store
    this.store.set("upload.recording.isRecording", false);

    console.log("[AudioRecorder] Recording stopped");
  }

  /**
   * Handle data available from MediaRecorder
   */
  handleDataAvailable(event) {
    if (event.data && event.data.size > 0) {
      this.audioChunks.push(event.data);

      // Log progress
      const totalSize = this.audioChunks.reduce(
        (sum, chunk) => sum + chunk.size,
        0
      );
      console.log(
        `[AudioRecorder] Chunk received, total size: ${(
          totalSize /
          1024 /
          1024
        ).toFixed(2)} MB`
      );
    }
  }

  /**
   * Handle recording stop - create blob and convert to WAV
   */
  async handleStop() {
    console.log("[AudioRecorder] Processing recording...");

    try {
      // Create WebM blob from chunks
      const webmBlob = new Blob(this.audioChunks, { type: "audio/webm" });
      console.log(
        `[AudioRecorder] WebM blob created: ${(
          webmBlob.size /
          1024 /
          1024
        ).toFixed(2)} MB`
      );

      // Convert to WAV
      const wavBlob = await this.convertToWav(webmBlob);
      console.log(
        `[AudioRecorder] WAV blob created: ${(
          wavBlob.size /
          1024 /
          1024
        ).toFixed(2)} MB`
      );

      // Store the blob
      this.audioBlob = wavBlob;

      // Create URL for playback
      this.audioUrl = URL.createObjectURL(wavBlob);

      // Update store
      this.store.set("upload.recording.audioBlob", wavBlob);
      this.store.set("upload.recording.audioUrl", this.audioUrl);
      this.store.set("upload.recording.duration", Date.now() - this.startTime);

      // Update UI to review state
      this.updateUI("review");

      console.log("[AudioRecorder] Recording processed successfully");
    } catch (error) {
      console.error("[AudioRecorder] Failed to process recording:", error);
      this.store.actions.showError(
        "Fehler beim Verarbeiten der Aufnahme: " + error.message
      );
      this.updateUI("idle");
    }
  }

  /**
   * Convert WebM to WAV format
   */
  async convertToWav(webmBlob) {
    console.log("[AudioRecorder] Converting WebM to WAV...");

    try {
      // Create audio context
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 44100,
      });

      // Decode the WebM audio data
      const arrayBuffer = await webmBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      console.log(
        `[AudioRecorder] Audio decoded: ${audioBuffer.duration}s, ${audioBuffer.sampleRate}Hz`
      );

      // Convert to WAV
      const wavBuffer = this.encodeWAV(audioBuffer);
      const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });

      // Clean up
      await audioContext.close();

      return wavBlob;
    } catch (error) {
      console.error("[AudioRecorder] WAV conversion failed:", error);
      // Fallback: return original WebM
      console.warn("[AudioRecorder] Using WebM format as fallback");
      return webmBlob;
    }
  }

  /**
   * Encode AudioBuffer to WAV format
   */
  encodeWAV(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitsPerSample = 16;

    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = audioBuffer.length * blockAlign;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    // RIFF chunk descriptor
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");

    // fmt sub-chunk
    writeString(12, "fmt ");
    view.setUint32(16, 16, true); // subchunk1size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    // Write interleaved PCM samples
    let offset = 44;
    const channels = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(audioBuffer.getChannelData(ch));
    }

    for (let i = 0; i < audioBuffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = channels[ch][i];
        sample = Math.max(-1, Math.min(1, sample)); // Clamp
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, sample, true);
        offset += 2;
      }
    }

    return buffer;
  }

  /**
   * Start the timer display
   */
  startTimer() {
    this.timerInterval = setInterval(this.updateTimer, 100);
    this.updateTimer();
  }

  /**
   * Stop the timer
   */
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Update timer display
   */
  updateTimer() {
    if (!this.elements.timerDisplay) return;

    const elapsed = Date.now() - this.startTime;
    const seconds = Math.floor(elapsed / 1000) % 60;
    const minutes = Math.floor(elapsed / 60000) % 60;
    const hours = Math.floor(elapsed / 3600000);

    let display = "";
    if (hours > 0) {
      display = `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
    } else {
      display = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    this.elements.timerDisplay.textContent = display;
  }

  /**
   * Update UI based on state
   */
  updateUI(state) {
    console.log(`[AudioRecorder] UI state: ${state}`);

    switch (state) {
      case "idle":
        if (this.elements.recordButton) {
          this.elements.recordButton.textContent = "Aufnahme starten";
          this.elements.recordButton.classList.remove("recording");
        }
        if (this.elements.timerDisplay) {
          this.elements.timerDisplay.style.display = "none";
        }
        if (this.elements.playbackControls) {
          this.elements.playbackControls.style.display = "none";
        }
        break;

      case "recording":
        if (this.elements.recordButton) {
          this.elements.recordButton.textContent = "Aufnahme stoppen";
          this.elements.recordButton.classList.add("recording");
        }
        if (this.elements.timerDisplay) {
          this.elements.timerDisplay.style.display = "block";
        }
        if (this.elements.playbackControls) {
          this.elements.playbackControls.style.display = "none";
        }
        break;

      case "review":
        if (this.elements.recordButton) {
          this.elements.recordButton.textContent = "Neue Aufnahme";
          this.elements.recordButton.classList.remove("recording");
        }
        if (this.elements.timerDisplay) {
          this.elements.timerDisplay.style.display = "none";
        }
        if (this.elements.playbackControls) {
          this.elements.playbackControls.style.display = "flex";
          if (this.elements.audioPlayer) {
            this.elements.audioPlayer.src = this.audioUrl;
          }
        }
        break;
    }
  }

  /**
   * Get the audio blob for upload
   */
  getBlob() {
    return this.audioBlob;
  }

  /**
   * Reset recorder
   */
  reset() {
    // Clean up
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }

    this.audioBlob = null;
    this.audioChunks = [];
    this.startTime = null;

    // Update UI
    this.updateUI("idle");

    // Clear store
    this.store.set("upload.recording.audioBlob", null);
    this.store.set("upload.recording.audioUrl", null);
    this.store.set("upload.recording.duration", 0);

    console.log("[AudioRecorder] Reset complete");
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stopRecording();
    this.reset();
    console.log("[AudioRecorder] Destroyed");
  }
}
