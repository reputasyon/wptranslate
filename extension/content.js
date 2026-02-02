// WhatsApp Voice Translator - Content Script (ISOLATED world)
// v1.4.1 - Multiple audio detection methods

(function() {
  'use strict';

  const processedMessages = new WeakSet();

  // Store captured blobs info
  const capturedBlobsInfo = new Map(); // size -> info
  const capturedBlobsByUrl = new Map(); // url -> info
  let pendingBlobRequests = new Map();

  // Store the last played audio info (multiple detection methods)
  let lastPlayedSize = null;
  let lastPlayedUrl = null;
  let lastPlayedTimestamp = 0;

  // Listen for messages from MAIN world interceptor
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    // When a new audio blob is captured
    if (event.data?.type === 'WVT_AUDIO_BLOB_CAPTURED') {
      console.log('[WVT] Audio blob captured:', event.data.size, 'bytes');
      const info = {
        url: event.data.url,
        type: event.data.blobType,
        size: event.data.size
      };
      capturedBlobsInfo.set(event.data.size, info);
      capturedBlobsByUrl.set(event.data.url, info);
    }

    // When audio playback starts (from AudioBufferSourceNode.start)
    if (event.data?.type === 'WVT_AUDIO_PLAYING') {
      console.log('[WVT] 🎵 Audio playing (Web Audio)! Size:', event.data.bufferSize);
      lastPlayedSize = event.data.bufferSize;
      lastPlayedTimestamp = event.data.timestamp;
    }

    // When HTMLAudioElement.play() is called
    if (event.data?.type === 'WVT_AUDIO_ELEMENT_PLAY') {
      console.log('[WVT] 🎵 Audio element play! URL:', event.data.src?.substring(0, 50));
      lastPlayedUrl = event.data.src;
      lastPlayedTimestamp = event.data.timestamp;

      // Also get size from URL
      const info = capturedBlobsByUrl.get(event.data.src);
      if (info) {
        lastPlayedSize = info.size;
      }
    }

    // When blob data is received
    if (event.data?.type === 'WVT_BLOB_DATA') {
      const requestId = event.data.requestId;
      if (pendingBlobRequests.has(requestId)) {
        const { resolve, reject } = pendingBlobRequests.get(requestId);
        pendingBlobRequests.delete(requestId);

        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve({
            base64: event.data.base64,
            type: event.data.blobType,
            size: event.data.size,
            url: event.data.url
          });
        }
      }
    }
  });

  // Request blob data from MAIN world by size
  function requestBlobBySize(size) {
    return new Promise((resolve, reject) => {
      const requestId = 'req_' + Date.now() + '_' + Math.random();

      const timeout = setTimeout(() => {
        pendingBlobRequests.delete(requestId);
        reject(new Error('Blob request timeout'));
      }, 5000);

      pendingBlobRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });

      window.postMessage({
        type: 'WVT_GET_BLOB_BY_SIZE',
        size: size,
        requestId: requestId
      }, '*');
    });
  }

  // Find voice messages
  function findVoiceMessages() {
    const voiceMessages = new Set();
    const selectors = [
      'button[aria-label="Sesli mesajı oynat"]',
      'button[aria-label="Play voice message"]',
      'span[data-icon="audio-play"]',
      'span[data-icon="ptt-play"]'
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        let parent = el.parentElement;
        let messageContainer = null;
        let attempts = 0;

        while (parent && attempts < 20) {
          if (parent.getAttribute('data-id') ||
              parent.getAttribute('role') === 'row' ||
              parent.classList.contains('message-in') ||
              parent.classList.contains('message-out') ||
              (parent.className?.includes?.('focusable-list-item'))) {
            messageContainer = parent;
            break;
          }
          parent = parent.parentElement;
          attempts++;
        }

        if (!messageContainer) {
          messageContainer = el.closest('[data-id]') ||
                            el.closest('[role="row"]') ||
                            el.closest('[tabindex="-1"]');
        }

        if (messageContainer) voiceMessages.add(messageContainer);
      });
    }

    return Array.from(voiceMessages);
  }

  // Get sender name
  function getSenderName(messageElement) {
    const senderEl = messageElement.querySelector('[data-pre-plain-text]');
    if (senderEl) {
      const text = senderEl.getAttribute('data-pre-plain-text');
      const match = text?.match(/\] (.+?):/);
      if (match) return match[1];
    }
    return null;
  }

  // Request blob by URL
  function requestBlobByUrl(url) {
    return new Promise((resolve, reject) => {
      const requestId = 'req_' + Date.now() + '_' + Math.random();

      const timeout = setTimeout(() => {
        pendingBlobRequests.delete(requestId);
        reject(new Error('Blob request timeout'));
      }, 5000);

      pendingBlobRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });

      window.postMessage({
        type: 'WVT_GET_BLOB_BY_URL',
        url: url,
        requestId: requestId
      }, '*');
    });
  }

  // Get audio blob by clicking play and detecting which audio starts playing
  async function getAudioFromMessage(messageElement) {
    // Find play button in this message
    const playButton = messageElement.querySelector(
      'button[aria-label="Sesli mesajı oynat"], button[aria-label="Play voice message"]'
    ) || messageElement.querySelector('span[data-icon="audio-play"], span[data-icon="ptt-play"]');

    if (!playButton) {
      console.log('[WVT] No play button found');
      return null;
    }

    // Reset last played info
    lastPlayedSize = null;
    lastPlayedUrl = null;
    const beforeClickTime = Date.now();

    // Click play
    console.log('[WVT] Clicking play to detect audio...');
    playButton.click();

    // Wait for audio detection (either Web Audio API or HTMLAudioElement)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));

      // Check if we detected audio playback after our click
      if (lastPlayedTimestamp >= beforeClickTime && (lastPlayedSize || lastPlayedUrl)) {
        console.log('[WVT] Detected audio! Size:', lastPlayedSize, 'URL:', lastPlayedUrl?.substring(0, 40));

        // Pause immediately
        setTimeout(() => {
          const pauseBtn = document.querySelector(
            'button[aria-label="Sesli mesajı duraklat"], button[aria-label="Pause voice message"], span[data-icon="audio-pause"], span[data-icon="ptt-pause"]'
          );
          if (pauseBtn) pauseBtn.click();
        }, 50);

        // Request blob - try by URL first, then by size
        try {
          let blobData;
          if (lastPlayedUrl) {
            console.log('[WVT] Requesting blob by URL...');
            blobData = await requestBlobByUrl(lastPlayedUrl);
          } else if (lastPlayedSize) {
            console.log('[WVT] Requesting blob by size...');
            blobData = await requestBlobBySize(lastPlayedSize);
          }

          if (blobData && blobData.base64) {
            console.log('[WVT] Got blob data:', blobData.size, 'bytes');

            // Convert base64 to blob
            const byteCharacters = atob(blobData.base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: blobData.type || 'audio/ogg' });

            return { blob, type: blobData.type || 'audio/ogg' };
          }
        } catch (e) {
          console.error('[WVT] Failed to get blob:', e);
        }
        break;
      }
    }

    // Timeout - pause if playing
    const pauseBtn = document.querySelector(
      'button[aria-label="Sesli mesajı duraklat"], button[aria-label="Pause voice message"], span[data-icon="audio-pause"], span[data-icon="ptt-pause"]'
    );
    if (pauseBtn) pauseBtn.click();

    console.log('[WVT] Timeout waiting for audio playback');
    return null;
  }

  // Convert blob to base64
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Send to background
  async function translateAudio(blob, mimeType, sender) {
    const base64 = await blobToBase64(blob);

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'TRANSLATE_AUDIO',
          audioData: { base64, mimeType },
          sender: sender
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response?.success) {
            resolve(response.data);
          } else {
            reject(new Error(response?.error || 'Çeviri hatası'));
          }
        }
      );
    });
  }

  // Create translate button
  function createTranslateButton(messageElement) {
    const button = document.createElement('button');
    button.className = 'wvt-translate-btn';
    button.innerHTML = '🌐';
    button.title = 'Çevir';

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (button.classList.contains('loading')) return;

      // Open side panel
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });

      button.classList.add('loading');
      button.innerHTML = '⏳';

      // Get audio from this specific message
      const audioData = await getAudioFromMessage(messageElement);

      if (!audioData) {
        console.log('[WVT] No audio blob available');
        button.innerHTML = '❌';
        button.title = 'Ses bulunamadı';
        button.classList.remove('loading');
        setTimeout(() => {
          button.innerHTML = '🌐';
          button.title = 'Çevir';
        }, 3000);
        return;
      }

      try {
        const sender = getSenderName(messageElement);
        await translateAudio(audioData.blob, audioData.type, sender);
        button.innerHTML = '✓';
        button.classList.add('done');
      } catch (error) {
        console.error('[WVT] Error:', error);
        button.innerHTML = '❌';
        setTimeout(() => { button.innerHTML = '🌐'; }, 2000);
      } finally {
        button.classList.remove('loading');
      }
    });

    return button;
  }

  // Add buttons
  let lastFoundCount = 0;
  function addTranslateButtons() {
    const voiceMessages = findVoiceMessages();

    if (voiceMessages.length > 0 && voiceMessages.length !== lastFoundCount) {
      console.log(`[WVT] Found ${voiceMessages.length} voice messages, ${capturedBlobsInfo.size} blobs captured`);
      lastFoundCount = voiceMessages.length;
    }

    voiceMessages.forEach(messageElement => {
      if (processedMessages.has(messageElement)) return;
      if (messageElement.querySelector('.wvt-translate-btn')) return;

      processedMessages.add(messageElement);

      const button = createTranslateButton(messageElement);
      const wrapper = document.createElement('div');
      wrapper.className = 'wvt-button-wrapper';
      wrapper.appendChild(button);

      const playButton = messageElement.querySelector(
        'button[aria-label="Sesli mesajı oynat"], button[aria-label="Play voice message"]'
      );

      const audioBubble = messageElement.querySelector('[class*="audio"]') ||
                          playButton?.closest('[class*="focusable"]') ||
                          playButton?.parentElement?.parentElement?.parentElement;

      if (audioBubble && audioBubble.parentElement) {
        audioBubble.parentElement.insertBefore(wrapper, audioBubble.nextSibling);
      } else {
        messageElement.appendChild(wrapper);
      }
    });
  }

  // Initialize
  function init() {
    console.log('[WVT] WhatsApp Voice Translator v1.4.1 loaded');

    setTimeout(addTranslateButtons, 2000);
    setTimeout(addTranslateButtons, 4000);

    const observer = new MutationObserver(() => addTranslateButtons());
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(addTranslateButtons, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 1000);
  }
})();
