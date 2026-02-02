// WhatsApp Voice Translator - Blob Interceptor (MAIN world)
// v1.4.1 - Comprehensive audio API interception

(function() {
  'use strict';

  if (window.__wvtInterceptorInstalled) return;
  window.__wvtInterceptorInstalled = true;

  console.log('[WVT-MAIN] Installing comprehensive interceptors...');

  // Store captured audio blobs by size
  const capturedBlobsBySize = new Map();

  // Track decoded audio buffers
  const decodedBufferSizes = new Map();

  // Last played info
  let lastPlayedBufferSize = null;
  let lastPlayedTimestamp = 0;

  // ==================== BLOB INTERCEPTION ====================
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function(blob) {
    const url = originalCreateObjectURL.call(this, blob);

    try {
      if (blob && blob.size > 1000) {
        const type = blob.type || 'unknown';
        if (type.includes('audio') || type.includes('ogg') || type.includes('opus')) {
          console.log('[WVT-MAIN] Audio blob:', blob.size, 'bytes');

          capturedBlobsBySize.set(blob.size, {
            blob: blob,
            url: url,
            type: type,
            size: blob.size,
            timestamp: Date.now()
          });

          window.postMessage({
            type: 'WVT_AUDIO_BLOB_CAPTURED',
            url: url,
            blobType: type,
            size: blob.size
          }, '*');
        }
      }
    } catch (e) {}

    return url;
  };

  // ==================== AUDIO CONTEXT INTERCEPTION ====================

  // Helper to wrap decodeAudioData
  function wrapDecodeAudioData(originalFn, contextName) {
    return function(arrayBuffer, successCallback, errorCallback) {
      const inputSize = arrayBuffer.byteLength;
      console.log(`[WVT-MAIN] ${contextName}.decodeAudioData called, size:`, inputSize);

      // Handle Promise-based API (no callbacks)
      if (!successCallback && !errorCallback) {
        return originalFn.call(this, arrayBuffer).then(audioBuffer => {
          const bufferKey = `${audioBuffer.duration.toFixed(4)}_${audioBuffer.length}`;
          decodedBufferSizes.set(bufferKey, inputSize);
          console.log(`[WVT-MAIN] Decoded (Promise):`, inputSize, '->', bufferKey);
          return audioBuffer;
        });
      }

      // Handle callback-based API
      const wrappedSuccess = (audioBuffer) => {
        const bufferKey = `${audioBuffer.duration.toFixed(4)}_${audioBuffer.length}`;
        decodedBufferSizes.set(bufferKey, inputSize);
        console.log(`[WVT-MAIN] Decoded (callback):`, inputSize, '->', bufferKey);
        if (successCallback) successCallback(audioBuffer);
      };

      return originalFn.call(this, arrayBuffer, wrappedSuccess, errorCallback);
    };
  }

  // Intercept AudioContext
  if (window.AudioContext) {
    const origDecode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = wrapDecodeAudioData(origDecode, 'AudioContext');
  }

  // Intercept webkitAudioContext
  if (window.webkitAudioContext) {
    const origDecode = webkitAudioContext.prototype.decodeAudioData;
    webkitAudioContext.prototype.decodeAudioData = wrapDecodeAudioData(origDecode, 'webkitAudioContext');
  }

  // Intercept OfflineAudioContext
  if (window.OfflineAudioContext) {
    const origDecode = OfflineAudioContext.prototype.decodeAudioData;
    OfflineAudioContext.prototype.decodeAudioData = wrapDecodeAudioData(origDecode, 'OfflineAudioContext');
  }

  // Intercept BaseAudioContext if it exists
  if (window.BaseAudioContext) {
    const origDecode = BaseAudioContext.prototype.decodeAudioData;
    if (origDecode) {
      BaseAudioContext.prototype.decodeAudioData = wrapDecodeAudioData(origDecode, 'BaseAudioContext');
    }
  }

  // ==================== AUDIO PLAYBACK INTERCEPTION ====================

  // Intercept AudioBufferSourceNode.start
  const originalStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    console.log('[WVT-MAIN] AudioBufferSourceNode.start() called');

    if (this.buffer) {
      const bufferKey = `${this.buffer.duration.toFixed(4)}_${this.buffer.length}`;
      const originalSize = decodedBufferSizes.get(bufferKey);

      if (originalSize) {
        console.log('[WVT-MAIN] ▶️ Playing audio, size:', originalSize);
        lastPlayedBufferSize = originalSize;
        lastPlayedTimestamp = Date.now();

        window.postMessage({
          type: 'WVT_AUDIO_PLAYING',
          bufferSize: originalSize,
          timestamp: lastPlayedTimestamp
        }, '*');
      } else {
        console.log('[WVT-MAIN] ▶️ Playing unknown audio buffer');
      }
    }

    return originalStart.apply(this, args);
  };

  // ==================== MEDIA ELEMENT INTERCEPTION ====================

  // Intercept HTMLAudioElement and HTMLMediaElement play
  const originalAudioPlay = HTMLAudioElement.prototype.play;
  HTMLAudioElement.prototype.play = function() {
    console.log('[WVT-MAIN] HTMLAudioElement.play() src:', this.src?.substring(0, 60));

    if (this.src && this.src.startsWith('blob:')) {
      window.postMessage({
        type: 'WVT_AUDIO_ELEMENT_PLAY',
        src: this.src,
        timestamp: Date.now()
      }, '*');
    }

    return originalAudioPlay.apply(this, arguments);
  };

  // Also watch for Audio element creation
  const originalAudio = window.Audio;
  window.Audio = function(src) {
    console.log('[WVT-MAIN] new Audio() created, src:', src?.substring(0, 60));
    const audio = new originalAudio(src);
    return audio;
  };
  window.Audio.prototype = originalAudio.prototype;

  // ==================== MESSAGE HANDLING ====================

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'WVT_GET_BLOB_BY_SIZE') {
      const size = event.data.size;
      console.log('[WVT-MAIN] Blob requested:', size);

      let blobData = capturedBlobsBySize.get(size);

      if (!blobData) {
        for (const [s, d] of capturedBlobsBySize) {
          if (Math.abs(s - size) <= 100) {
            blobData = d;
            break;
          }
        }
      }

      if (blobData) {
        const reader = new FileReader();
        reader.onload = () => {
          window.postMessage({
            type: 'WVT_BLOB_DATA',
            requestId: event.data.requestId,
            size: blobData.size,
            base64: reader.result.split(',')[1],
            blobType: blobData.type
          }, '*');
        };
        reader.readAsDataURL(blobData.blob);
      } else {
        window.postMessage({
          type: 'WVT_BLOB_DATA',
          requestId: event.data.requestId,
          error: 'Not found: ' + size
        }, '*');
      }
    }

    if (event.data?.type === 'WVT_GET_BLOB_BY_URL') {
      const url = event.data.url;
      let blobData = null;

      for (const [, d] of capturedBlobsBySize) {
        if (d.url === url) {
          blobData = d;
          break;
        }
      }

      if (blobData) {
        const reader = new FileReader();
        reader.onload = () => {
          window.postMessage({
            type: 'WVT_BLOB_DATA',
            requestId: event.data.requestId,
            url: url,
            size: blobData.size,
            base64: reader.result.split(',')[1],
            blobType: blobData.type
          }, '*');
        };
        reader.readAsDataURL(blobData.blob);
      }
    }
  });

  console.log('[WVT-MAIN] Interceptors v1.4.1 ready');
  console.log('[WVT-MAIN] Watching: createObjectURL, decodeAudioData, start(), Audio.play()');
})();
