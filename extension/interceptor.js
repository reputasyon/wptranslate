// WhatsApp Voice Translator - Blob Interceptor (MAIN world)
// v3.1.0 - Comprehensive audio API interception

(function() {
  'use strict';

  if (window.__wvtInterceptorInstalled) return;
  window.__wvtInterceptorInstalled = true;

  const MAX_CACHE_SIZE = 200;

  // Store captured audio blobs - keyed by URL for uniqueness
  const capturedBlobsByUrl = new Map();
  // Secondary index by size (for fallback lookups)
  const capturedBlobsBySize = new Map();

  // Track decoded audio buffers
  const decodedBufferSizes = new Map();

  // Evict oldest entries when cache is full
  function evictOldEntries(map, maxSize) {
    if (map.size <= maxSize) return;
    const keys = Array.from(map.keys());
    const toRemove = keys.slice(0, keys.length - maxSize);
    for (const key of toRemove) {
      map.delete(key);
    }
  }

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
          const info = { blob, url, type, size: blob.size, timestamp: Date.now() };

          capturedBlobsByUrl.set(url, info);
          capturedBlobsBySize.set(blob.size, info);

          evictOldEntries(capturedBlobsByUrl, MAX_CACHE_SIZE);
          evictOldEntries(capturedBlobsBySize, MAX_CACHE_SIZE);
          evictOldEntries(decodedBufferSizes, MAX_CACHE_SIZE);

          window.postMessage({
            type: 'WVT_AUDIO_BLOB_CAPTURED',
            url: url,
            blobType: type,
            size: blob.size
          }, window.location.origin);
        }
      }
    } catch (e) {}

    return url;
  };

  // ==================== AUDIO CONTEXT INTERCEPTION ====================

  function wrapDecodeAudioData(originalFn, contextName) {
    return function(arrayBuffer, successCallback, errorCallback) {
      const inputSize = arrayBuffer.byteLength;

      if (!successCallback && !errorCallback) {
        return originalFn.call(this, arrayBuffer).then(audioBuffer => {
          const bufferKey = `${audioBuffer.duration.toFixed(4)}_${audioBuffer.length}`;
          decodedBufferSizes.set(bufferKey, inputSize);
          return audioBuffer;
        });
      }

      const wrappedSuccess = (audioBuffer) => {
        const bufferKey = `${audioBuffer.duration.toFixed(4)}_${audioBuffer.length}`;
        decodedBufferSizes.set(bufferKey, inputSize);
        if (successCallback) successCallback(audioBuffer);
      };

      return originalFn.call(this, arrayBuffer, wrappedSuccess, errorCallback);
    };
  }

  if (window.AudioContext) {
    AudioContext.prototype.decodeAudioData = wrapDecodeAudioData(AudioContext.prototype.decodeAudioData, 'AudioContext');
  }
  if (window.webkitAudioContext) {
    webkitAudioContext.prototype.decodeAudioData = wrapDecodeAudioData(webkitAudioContext.prototype.decodeAudioData, 'webkitAudioContext');
  }
  if (window.OfflineAudioContext) {
    OfflineAudioContext.prototype.decodeAudioData = wrapDecodeAudioData(OfflineAudioContext.prototype.decodeAudioData, 'OfflineAudioContext');
  }
  if (window.BaseAudioContext && BaseAudioContext.prototype.decodeAudioData) {
    BaseAudioContext.prototype.decodeAudioData = wrapDecodeAudioData(BaseAudioContext.prototype.decodeAudioData, 'BaseAudioContext');
  }

  // ==================== AUDIO PLAYBACK INTERCEPTION ====================

  const originalStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    if (this.buffer) {
      const bufferKey = `${this.buffer.duration.toFixed(4)}_${this.buffer.length}`;
      const originalSize = decodedBufferSizes.get(bufferKey);

      if (originalSize) {
        lastPlayedBufferSize = originalSize;
        lastPlayedTimestamp = Date.now();

        window.postMessage({
          type: 'WVT_AUDIO_PLAYING',
          bufferSize: originalSize,
          timestamp: lastPlayedTimestamp
        }, window.location.origin);
      }
    }

    return originalStart.apply(this, args);
  };

  // ==================== MEDIA ELEMENT INTERCEPTION ====================

  const originalAudioPlay = HTMLAudioElement.prototype.play;
  HTMLAudioElement.prototype.play = function() {
    if (this.src && this.src.startsWith('blob:')) {
      window.postMessage({
        type: 'WVT_AUDIO_ELEMENT_PLAY',
        src: this.src,
        timestamp: Date.now()
      }, window.location.origin);
    }

    return originalAudioPlay.apply(this, arguments);
  };

  // ==================== MESSAGE HANDLING ====================

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'WVT_GET_BLOB_BY_SIZE') {
      const size = event.data.size;
      let blobData = capturedBlobsBySize.get(size);

      // Fuzzy match if exact match fails
      if (!blobData) {
        for (const [s, d] of capturedBlobsBySize) {
          if (Math.abs(s - size) <= 100) { blobData = d; break; }
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
          }, window.location.origin);
        };
        reader.readAsDataURL(blobData.blob);
      } else {
        window.postMessage({
          type: 'WVT_BLOB_DATA',
          requestId: event.data.requestId,
          error: 'Not found: ' + size
        }, window.location.origin);
      }
    }

    if (event.data?.type === 'WVT_GET_BLOB_BY_URL') {
      const url = event.data.url;
      const blobData = capturedBlobsByUrl.get(url);

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
          }, window.location.origin);
        };
        reader.readAsDataURL(blobData.blob);
      } else {
        // FIX: Send error response instead of silence
        window.postMessage({
          type: 'WVT_BLOB_DATA',
          requestId: event.data.requestId,
          error: 'Not found by URL'
        }, window.location.origin);
      }
    }
  });
})();
