// WhatsApp Voice Translator - Blob Interceptor (MAIN world)
// v1.2.0 - Intercepts audio blobs and notifies content script

(function() {
  'use strict';

  if (window.__wvtInterceptorInstalled) return;
  window.__wvtInterceptorInstalled = true;

  console.log('[WVT-Inject] Installing blob interceptor...');

  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function(blob) {
    const url = originalCreateObjectURL.call(this, blob);

    if (blob && blob.size > 1000) {
      const type = blob.type || 'unknown';

      // Only capture non-image blobs (likely audio/video)
      if (!type.startsWith('image/')) {
        console.log('[WVT-Inject] Audio blob captured:', type, blob.size);

        // Notify content script
        window.postMessage({
          type: 'WVT_AUDIO_BLOB_CAPTURED',
          url: url,
          blobType: type,
          size: blob.size
        }, '*');
      }
    }

    return url;
  };

  console.log('[WVT-Inject] Blob interceptor installed successfully');
})();
