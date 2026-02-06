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

  // ==================== INLINE TRANSLATION DISPLAY ====================

  // Language code mapping for inline reply
  const langCodes = {
    'Arapça': 'ar', 'Rusça': 'ru', 'İngilizce': 'en', 'Almanca': 'de',
    'Fransızca': 'fr', 'İspanyolca': 'es', 'Farsça': 'fa', 'Urduca': 'ur',
    'Hintçe': 'hi', 'Kürtçe': 'ku', 'Azerice': 'az', 'İbranice': 'he',
    'Çince': 'zh', 'Japonca': 'ja', 'Korece': 'ko', 'Portekizce': 'pt',
    'İtalyanca': 'it', 'Yunanca': 'el', 'Ukraynaca': 'uk', 'Türkçe': 'tr'
  };

  function showInlineTranslation(messageElement, data) {
    // Remove existing inline translation if any
    const existing = messageElement.querySelector('.wvt-inline');
    if (existing) existing.remove();

    const lang = data.detectedLanguage || '';
    const langCode = langCodes[lang] || lang.toLowerCase().substring(0, 2);
    const inlineId = 'wvt_' + Date.now();

    const div = document.createElement('div');
    div.className = 'wvt-inline';
    div.innerHTML = `
      <div class="wvt-inline-header">
        <span class="wvt-inline-lang">${escapeHtml(lang)}</span>
        <button class="wvt-inline-close" title="Kapat">&times;</button>
      </div>
      <div class="wvt-inline-text">${escapeHtml(data.translation || '')}</div>
      <div class="wvt-inline-reply">
        <button class="wvt-inline-reply-toggle">💬 Cevap Yaz</button>
        <div class="wvt-inline-reply-form" style="display:none;">
          <input type="text" class="wvt-inline-reply-input" placeholder="Türkçe cevabınızı yazın..." />
          <div class="wvt-inline-reply-actions">
            <button class="wvt-inline-reply-btn" data-lang="${escapeHtml(langCode)}" data-langname="${escapeHtml(lang)}">🌐 ${escapeHtml(lang)}'ya Çevir</button>
          </div>
          <div class="wvt-inline-reply-result" style="display:none;">
            <div class="wvt-inline-reply-result-text"></div>
            <div class="wvt-inline-reply-result-actions">
              <button class="wvt-inline-copy-btn">📋 Kopyala</button>
              <button class="wvt-inline-paste-btn">📤 Yapıştır</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Close button
    div.querySelector('.wvt-inline-close').addEventListener('click', (e) => {
      e.stopPropagation();
      div.remove();
    });

    // Reply toggle
    div.querySelector('.wvt-inline-reply-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      const form = div.querySelector('.wvt-inline-reply-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
      if (form.style.display === 'block') {
        div.querySelector('.wvt-inline-reply-input').focus();
      }
    });

    // Reply translate button
    div.querySelector('.wvt-inline-reply-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const input = div.querySelector('.wvt-inline-reply-input');
      const turkishText = input.value.trim();
      if (!turkishText) return;

      const targetLangCode = btn.dataset.lang;
      const targetLangName = btn.dataset.langname;

      btn.disabled = true;
      btn.textContent = '⏳ Çevriliyor...';

      try {
        const response = await fetch('http://localhost:3456/translate-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: turkishText, targetLanguage: targetLangCode })
        });
        const result = await response.json();

        if (result.success && result.translation) {
          const resultDiv = div.querySelector('.wvt-inline-reply-result');
          const resultText = div.querySelector('.wvt-inline-reply-result-text');
          resultText.textContent = result.translation;
          resultDiv.style.display = 'block';
        }
      } catch (err) {
        console.error('[WVT] Inline reply error:', err);
      } finally {
        btn.disabled = false;
        btn.textContent = `🌐 ${targetLangName}'ya Çevir`;
      }
    });

    // Stop all event propagation on the inline container so WhatsApp doesn't steal focus
    const inlineInput = div.querySelector('.wvt-inline-reply-input');
    ['mousedown', 'click', 'focus', 'focusin', 'keydown', 'keyup', 'keypress', 'input'].forEach(evt => {
      inlineInput.addEventListener(evt, (e) => {
        e.stopPropagation();
      });
    });
    // Also stop propagation on the entire inline container for mouse events
    div.addEventListener('mousedown', (e) => e.stopPropagation());
    div.addEventListener('click', (e) => e.stopPropagation());

    // Enter key to translate
    inlineInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        div.querySelector('.wvt-inline-reply-btn').click();
      }
    });

    // Copy button
    div.querySelector('.wvt-inline-copy-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = div.querySelector('.wvt-inline-reply-result-text').textContent;
      await navigator.clipboard.writeText(text);
      e.currentTarget.textContent = '✅ Kopyalandı';
      setTimeout(() => { e.currentTarget.textContent = '📋 Kopyala'; }, 2000);
    });

    // Paste button
    div.querySelector('.wvt-inline-paste-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const text = div.querySelector('.wvt-inline-reply-result-text').textContent;
      const success = pasteToWhatsAppInput(text);
      e.currentTarget.textContent = success ? '✅ Yapıştırıldı' : '❌ Hata';
      setTimeout(() => { e.currentTarget.textContent = '📤 Yapıştır'; }, 2000);
    });

    // Insert after the message bubble
    const bubble = messageElement.querySelector('[data-pre-plain-text]')?.parentElement ||
                   messageElement.querySelector('.copyable-text')?.parentElement ||
                   messageElement.querySelector('[class*="focusable"]') ||
                   messageElement;

    if (bubble.parentElement) {
      bubble.parentElement.insertBefore(div, bubble.nextSibling);
    } else {
      messageElement.appendChild(div);
    }
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  // ==================== PASTE TO WHATSAPP INPUT ====================

  function pasteToWhatsAppInput(text) {
    const input = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                  document.querySelector('footer div[contenteditable="true"]') ||
                  document.querySelector('div[contenteditable="true"][role="textbox"]');

    if (!input) {
      console.log('[WVT] WhatsApp input not found');
      return false;
    }

    input.focus();
    document.execCommand('insertText', false, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    console.log('[WVT] Text pasted to WhatsApp input');
    return true;
  }

  // Listen for paste messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PASTE_TO_INPUT') {
      const success = pasteToWhatsAppInput(message.text);
      sendResponse({ success });
    }

    if (message.type === 'CONTEXT_TRANSLATE') {
      const selectedText = window.getSelection().toString().trim();
      if (selectedText) {
        handleContextTranslate(selectedText);
      }
      sendResponse({ success: true });
    }
  });

  // Handle context menu translation
  async function handleContextTranslate(text) {
    try {
      // Find message container from selection for context
      let msgContainer = null;
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        let node = selection.getRangeAt(0).startContainer;
        if (node.nodeType === 3) node = node.parentElement;
        let el = node;
        let attempts = 0;
        while (el && attempts < 25) {
          if (el.getAttribute?.('data-id') || el.getAttribute?.('role') === 'row') {
            msgContainer = el;
            break;
          }
          el = el.parentElement;
          attempts++;
        }
      }

      const context = msgContainer ? getConversationContext(msgContainer) : [];
      const result = await translateText(text, null, context);
      // Show inline near the selection
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        let container = range.startContainer;
        if (container.nodeType === 3) container = container.parentElement;

        // Walk up to message container
        let msgContainer = container;
        let attempts = 0;
        while (msgContainer && attempts < 25) {
          if (msgContainer.getAttribute?.('data-id') ||
              msgContainer.getAttribute?.('role') === 'row') {
            break;
          }
          msgContainer = msgContainer.parentElement;
          attempts++;
        }

        if (msgContainer) {
          showInlineTranslation(msgContainer, result);
        }
      }
    } catch (error) {
      console.error('[WVT] Context translate error:', error);
    }
  }

  // ==================== VOICE TRANSLATE BUTTON ====================

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
        const result = await translateAudio(audioData.blob, audioData.type, sender);
        button.innerHTML = '✓';
        button.classList.add('done');
        // Show inline translation
        showInlineTranslation(messageElement, result);
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

  // ==================== TEXT MESSAGE TRANSLATION ====================

  const processedTextMessages = new WeakSet();

  // Debug: log once what selectors match
  let textDebugDone = false;
  function debugTextSelectors() {
    if (textDebugDone) return;
    textDebugDone = true;

    const tests = {
      'span.selectable-text': document.querySelectorAll('span.selectable-text').length,
      'div.copyable-text': document.querySelectorAll('div.copyable-text').length,
      '.copyable-text': document.querySelectorAll('.copyable-text').length,
      '[data-pre-plain-text]': document.querySelectorAll('[data-pre-plain-text]').length,
      '[role="row"]': document.querySelectorAll('[role="row"]').length,
      '[data-id]': document.querySelectorAll('[data-id]').length,
      '.message-in': document.querySelectorAll('.message-in').length,
      '.message-out': document.querySelectorAll('.message-out').length,
      'span[dir]': document.querySelectorAll('span[dir]').length,
      'span[dir="ltr"]': document.querySelectorAll('span[dir="ltr"]').length,
      'span[dir="rtl"]': document.querySelectorAll('span[dir="rtl"]').length,
    };
    console.log('[WVT] DOM selector debug:', tests);
  }

  // Find the text-bearing element inside a message
  // Use the LAST span.selectable-text - the actual message body is always last,
  // quoted/forwarded headers come first
  function findTextElement(container) {
    const allSelectable = container.querySelectorAll('span.selectable-text, .selectable-text');
    if (allSelectable.length > 0) {
      return allSelectable[allSelectable.length - 1];
    }
    // Fallback: span[dir] inside copyable-text
    const copyable = container.querySelector('[data-pre-plain-text]') ||
                     container.querySelector('.copyable-text');
    if (copyable) {
      const dirs = copyable.querySelectorAll('span[dir]');
      if (dirs.length > 0) return dirs[dirs.length - 1];
    }
    return null;
  }

  // Find text messages - try multiple strategies
  function findTextMessages() {
    const textMessages = new Set();

    // Debug selectors on first run
    debugTextSelectors();

    // Primary: find [data-pre-plain-text] and .copyable-text (actual message bodies, not UI labels)
    // Fallback: span.selectable-text
    const textAnchors = new Set();

    // Priority 1: data-pre-plain-text (most reliable - actual message body wrapper)
    document.querySelectorAll('[data-pre-plain-text]').forEach(el => textAnchors.add(el));
    document.querySelectorAll('.copyable-text').forEach(el => textAnchors.add(el));

    // Priority 2: if nothing found, try selectable-text
    if (textAnchors.size === 0) {
      document.querySelectorAll('span.selectable-text, .selectable-text').forEach(el => textAnchors.add(el));
    }

    // Priority 3: if still nothing, try span[dir]
    if (textAnchors.size === 0) {
      document.querySelectorAll('[role="row"] span[dir], [data-id] span[dir]').forEach(el => {
        if (el.textContent.trim().length >= 2) {
          textAnchors.add(el);
        }
      });
    }

    textAnchors.forEach(anchor => {
      // Get the actual message text (from inside the body, not headers/labels)
      let textContent = '';
      if (anchor.hasAttribute?.('data-pre-plain-text') || anchor.classList?.contains('copyable-text')) {
        const inner = anchor.querySelector('span.selectable-text') ||
                      anchor.querySelector('.selectable-text') ||
                      anchor.querySelector('span[dir]');
        textContent = inner ? inner.textContent.trim() : '';
      } else {
        textContent = anchor.textContent.trim();
      }

      if (textContent.length < 2) return;

      // Walk up to find message container
      let parent = anchor.parentElement;
      let messageContainer = null;
      let attempts = 0;

      while (parent && attempts < 25) {
        if (parent.getAttribute('data-id') ||
            parent.getAttribute('role') === 'row' ||
            parent.classList?.contains('message-in') ||
            parent.classList?.contains('message-out') ||
            parent.className?.includes?.('focusable-list-item')) {
          messageContainer = parent;
          break;
        }
        parent = parent.parentElement;
        attempts++;
      }

      if (!messageContainer) {
        messageContainer = anchor.closest('[data-id]') ||
                          anchor.closest('[role="row"]') ||
                          anchor.closest('[tabindex="-1"]');
      }

      if (!messageContainer) return;

      // Skip voice messages
      if (messageContainer.querySelector('button[aria-label="Sesli mesajı oynat"], button[aria-label="Play voice message"], span[data-icon="audio-play"], span[data-icon="ptt-play"]')) return;

      // Skip already processed
      if (processedTextMessages.has(messageContainer)) return;
      if (messageContainer.querySelector('.wvt-text-translate-btn')) return;

      textMessages.add(messageContainer);
    });

    return Array.from(textMessages);
  }

  // Get text content from a message element
  function getMessageText(messageElement) {
    const textEl = findTextElement(messageElement);
    return textEl ? textEl.textContent.trim() : '';
  }

  // Extract conversation context - last N messages around the target message
  function getConversationContext(targetMessageElement, maxMessages = 8) {
    const context = [];

    // Get all message rows in the chat
    const allRows = Array.from(document.querySelectorAll('[role="row"]'));
    const targetIndex = allRows.indexOf(targetMessageElement);

    // If not found by role=row, try data-id
    let rows = allRows;
    let idx = targetIndex;
    if (idx === -1) {
      rows = Array.from(document.querySelectorAll('[data-id]'));
      idx = rows.indexOf(targetMessageElement);
    }

    if (idx === -1) return [];

    // Grab messages before the target
    const start = Math.max(0, idx - maxMessages);
    for (let i = start; i < idx; i++) {
      const row = rows[i];
      const textEl = findTextElement(row);
      if (!textEl) continue;

      const text = textEl.textContent.trim();
      if (!text || text.length < 1) continue;

      // Determine if sent or received
      const isOutgoing = row.querySelector('[data-icon="msg-dblcheck"], [data-icon="msg-check"]') ||
                         row.classList?.contains('message-out') ||
                         row.querySelector('.message-out');
      const sender = isOutgoing ? 'Sen' : (getSenderName(row) || 'Karşı');

      context.push({ sender, text });
    }

    return context;
  }

  // Send text to background for translation
  async function translateText(text, sender, context) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'TRANSLATE_TEXT_MESSAGE',
          text: text,
          sender: sender,
          context: context || []
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

  // Create translate button for text messages
  function createTextTranslateButton(messageElement) {
    const button = document.createElement('button');
    button.className = 'wvt-translate-btn wvt-text-translate-btn';
    button.dataset.textBtn = 'true';
    button.innerHTML = '🌐';
    button.title = 'Metni Çevir';

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (button.classList.contains('loading')) return;

      button.classList.add('loading');
      button.innerHTML = '⏳';

      const text = getMessageText(messageElement);
      if (!text) {
        button.innerHTML = '❌';
        button.classList.remove('loading');
        setTimeout(() => { button.innerHTML = '🌐'; }, 2000);
        return;
      }

      try {
        const sender = getSenderName(messageElement);
        const context = getConversationContext(messageElement);
        const result = await translateText(text, sender, context);
        button.innerHTML = '✓';
        button.classList.add('done');
        // Show inline translation
        showInlineTranslation(messageElement, result);
      } catch (error) {
        console.error('[WVT] Text translation error:', error);
        button.innerHTML = '❌';
        setTimeout(() => { button.innerHTML = '🌐'; }, 2000);
      } finally {
        button.classList.remove('loading');
      }
    });

    return button;
  }

  // Add text translate buttons
  let lastTextCount = 0;
  function addTextTranslateButtons() {
    const textMessages = findTextMessages();

    if (textMessages.length > 0 && textMessages.length !== lastTextCount) {
      console.log(`[WVT] Found ${textMessages.length} text messages for translation`);
      lastTextCount = textMessages.length;
    }

    textMessages.forEach(messageElement => {
      if (processedTextMessages.has(messageElement)) return;
      if (messageElement.querySelector('.wvt-text-translate-btn')) return;

      processedTextMessages.add(messageElement);

      const button = createTextTranslateButton(messageElement);
      const wrapper = document.createElement('div');
      wrapper.className = 'wvt-button-wrapper';
      wrapper.appendChild(button);

      // Same placement logic as voice messages: find the bubble and insert after it
      const textEl = findTextElement(messageElement);
      const copyableText = messageElement.querySelector('[data-pre-plain-text]') ||
                           messageElement.querySelector('.copyable-text');
      const textBubble = copyableText?.closest('[class*="focusable"]') ||
                         copyableText?.parentElement ||
                         textEl?.closest('[class*="focusable"]') ||
                         textEl?.parentElement?.parentElement?.parentElement;

      if (textBubble && textBubble.parentElement) {
        textBubble.parentElement.insertBefore(wrapper, textBubble.nextSibling);
      } else {
        messageElement.appendChild(wrapper);
      }
    });
  }

  // ==================== IMAGE MESSAGE TRANSLATION ====================

  const processedImageMessages = new WeakSet();

  function findImageMessages() {
    const imageMessages = new Set();

    // Find images inside message rows
    document.querySelectorAll('img[src*="blob:"], img[src*="media"]').forEach(img => {
      // Skip small images (icons, avatars)
      if (img.naturalWidth < 100 || img.naturalHeight < 100) return;
      if (img.width < 100 || img.height < 100) return;

      // Walk up to message container
      let parent = img.parentElement;
      let messageContainer = null;
      let attempts = 0;

      while (parent && attempts < 25) {
        if (parent.getAttribute('data-id') ||
            parent.getAttribute('role') === 'row') {
          messageContainer = parent;
          break;
        }
        parent = parent.parentElement;
        attempts++;
      }

      if (!messageContainer) {
        messageContainer = img.closest('[data-id]') || img.closest('[role="row"]');
      }

      if (!messageContainer) return;
      if (processedImageMessages.has(messageContainer)) return;
      if (messageContainer.querySelector('.wvt-img-translate-btn')) return;

      imageMessages.add(messageContainer);
    });

    return Array.from(imageMessages);
  }

  async function getImageBase64(img) {
    // Try fetching the blob URL
    if (img.src.startsWith('blob:')) {
      try {
        const response = await fetch(img.src);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve({
            base64: reader.result.split(',')[1],
            mimeType: blob.type || 'image/jpeg'
          });
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.log('[WVT] Blob fetch failed, using canvas fallback');
      }
    }

    // Canvas fallback
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return {
      base64: dataUrl.split(',')[1],
      mimeType: 'image/jpeg'
    };
  }

  function createImageTranslateButton(messageElement) {
    const button = document.createElement('button');
    button.className = 'wvt-translate-btn wvt-img-translate-btn';
    button.innerHTML = '🌐';
    button.title = 'Resimdeki Metni Çevir';

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (button.classList.contains('loading')) return;

      button.classList.add('loading');
      button.innerHTML = '⏳';

      try {
        const img = messageElement.querySelector('img[src*="blob:"], img[src*="media"]');
        if (!img) throw new Error('Resim bulunamadı');

        const { base64, mimeType } = await getImageBase64(img);

        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'TRANSLATE_IMAGE',
            imageData: base64,
            mimeType: mimeType
          }, (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else if (response?.success) resolve(response.data);
            else reject(new Error(response?.error || 'Çeviri hatası'));
          });
        });

        button.innerHTML = '✓';
        button.classList.add('done');
        showInlineTranslation(messageElement, result);
      } catch (error) {
        console.error('[WVT] Image translation error:', error);
        button.innerHTML = '❌';
        setTimeout(() => { button.innerHTML = '🌐'; }, 2000);
      } finally {
        button.classList.remove('loading');
      }
    });

    return button;
  }

  function addImageTranslateButtons() {
    const imageMessages = findImageMessages();

    imageMessages.forEach(messageElement => {
      if (processedImageMessages.has(messageElement)) return;
      if (messageElement.querySelector('.wvt-img-translate-btn')) return;

      processedImageMessages.add(messageElement);

      const button = createImageTranslateButton(messageElement);
      const wrapper = document.createElement('div');
      wrapper.className = 'wvt-button-wrapper';
      wrapper.appendChild(button);

      const img = messageElement.querySelector('img[src*="blob:"], img[src*="media"]');
      const imgContainer = img?.closest('[class*="focusable"]') ||
                           img?.parentElement?.parentElement;

      if (imgContainer && imgContainer.parentElement) {
        imgContainer.parentElement.insertBefore(wrapper, imgContainer.nextSibling);
      } else {
        messageElement.appendChild(wrapper);
      }
    });
  }

  // ==================== ADD BUTTONS (VOICE + TEXT + IMAGE) ====================

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

    // Also add text and image translate buttons
    addTextTranslateButtons();
    addImageTranslateButtons();
  }

  // Initialize
  function init() {
    console.log('[WVT] WhatsApp Translator v3.0.0 loaded');

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
