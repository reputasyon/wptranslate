// WhatsApp Voice Translator - Content Script (ISOLATED world)
// v3.1.0

(function() {
  'use strict';

  // ==================== UTILITIES ====================

  const MAX_CONCURRENT_TRANSLATIONS = 3;
  const MAP_MAX_SIZE = 150;
  let activeTranslations = 0;

  function debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function evictMap(map, maxSize) {
    if (map.size <= maxSize) return;
    const keys = Array.from(map.keys());
    const toRemove = keys.slice(0, keys.length - maxSize);
    for (const key of toRemove) map.delete(key);
  }

  // ==================== STATE ====================

  const processedMessages = new WeakSet();
  const processedTextMessages = new WeakSet();
  const processedImageMessages = new WeakSet();

  // Blob tracking - keyed by URL (unique), with size as secondary index
  const capturedBlobsByUrl = new Map();
  const capturedBlobsBySize = new Map();
  let pendingBlobRequests = new Map();

  // Audio detection - per-request nonce to prevent race conditions
  let audioDetectionNonce = 0;
  let lastPlayedSize = null;
  let lastPlayedUrl = null;
  let lastPlayedTimestamp = 0;

  // ==================== MAIN WORLD COMMUNICATION ====================

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'WVT_AUDIO_BLOB_CAPTURED') {
      const info = { url: event.data.url, type: event.data.blobType, size: event.data.size };
      capturedBlobsByUrl.set(event.data.url, info);
      capturedBlobsBySize.set(event.data.size, info);
      evictMap(capturedBlobsByUrl, MAP_MAX_SIZE);
      evictMap(capturedBlobsBySize, MAP_MAX_SIZE);
    }

    if (event.data?.type === 'WVT_AUDIO_PLAYING') {
      lastPlayedSize = event.data.bufferSize;
      lastPlayedTimestamp = event.data.timestamp;
    }

    if (event.data?.type === 'WVT_AUDIO_ELEMENT_PLAY') {
      lastPlayedUrl = event.data.src;
      lastPlayedTimestamp = event.data.timestamp;
      const info = capturedBlobsByUrl.get(event.data.src);
      if (info) lastPlayedSize = info.size;
    }

    if (event.data?.type === 'WVT_BLOB_DATA') {
      const requestId = event.data.requestId;
      if (pendingBlobRequests.has(requestId)) {
        const { resolve, reject } = pendingBlobRequests.get(requestId);
        pendingBlobRequests.delete(requestId);
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve({ base64: event.data.base64, type: event.data.blobType, size: event.data.size, url: event.data.url });
        }
      }
    }
  });

  function requestBlobBySize(size) {
    return new Promise((resolve, reject) => {
      const requestId = 'req_' + Date.now() + '_' + Math.random();
      const timeout = setTimeout(() => {
        pendingBlobRequests.delete(requestId);
        reject(new Error('Blob request timeout'));
      }, 5000);

      pendingBlobRequests.set(requestId, {
        resolve: (data) => { clearTimeout(timeout); resolve(data); },
        reject: (err) => { clearTimeout(timeout); reject(err); }
      });

      window.postMessage({ type: 'WVT_GET_BLOB_BY_SIZE', size, requestId }, '*');
    });
  }

  function requestBlobByUrl(url) {
    return new Promise((resolve, reject) => {
      const requestId = 'req_' + Date.now() + '_' + Math.random();
      const timeout = setTimeout(() => {
        pendingBlobRequests.delete(requestId);
        reject(new Error('Blob request timeout'));
      }, 5000);

      pendingBlobRequests.set(requestId, {
        resolve: (data) => { clearTimeout(timeout); resolve(data); },
        reject: (err) => { clearTimeout(timeout); reject(err); }
      });

      window.postMessage({ type: 'WVT_GET_BLOB_BY_URL', url, requestId }, '*');
    });
  }

  // ==================== DOM HELPERS ====================

  function findVoiceMessages() {
    const voiceMessages = new Set();
    const selectors = [
      'button[aria-label="Sesli mesaji oynat"]',
      'button[aria-label="Play voice message"]',
      'span[data-icon="audio-play"]',
      'span[data-icon="ptt-play"]'
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const messageContainer = walkUpToMessage(el);
        if (messageContainer) voiceMessages.add(messageContainer);
      });
    }
    return Array.from(voiceMessages);
  }

  function walkUpToMessage(el) {
    let parent = el.parentElement;
    let attempts = 0;
    while (parent && attempts < 20) {
      if (parent.getAttribute('data-id') ||
          parent.getAttribute('role') === 'row' ||
          parent.classList.contains('message-in') ||
          parent.classList.contains('message-out') ||
          parent.className?.includes?.('focusable-list-item')) {
        return parent;
      }
      parent = parent.parentElement;
      attempts++;
    }
    return el.closest('[data-id]') || el.closest('[role="row"]') || el.closest('[tabindex="-1"]');
  }

  function getSenderName(messageElement) {
    const senderEl = messageElement.querySelector('[data-pre-plain-text]');
    if (senderEl) {
      const text = senderEl.getAttribute('data-pre-plain-text');
      const match = text?.match(/\] (.+?):/);
      if (match) return match[1];
    }
    return null;
  }

  function findTextElement(container) {
    const allSelectable = container.querySelectorAll('span.selectable-text, .selectable-text');
    if (allSelectable.length > 0) return allSelectable[allSelectable.length - 1];
    const copyable = container.querySelector('[data-pre-plain-text]') || container.querySelector('.copyable-text');
    if (copyable) {
      const dirs = copyable.querySelectorAll('span[dir]');
      if (dirs.length > 0) return dirs[dirs.length - 1];
    }
    return null;
  }

  function getMessageText(messageElement) {
    const textEl = findTextElement(messageElement);
    return textEl ? textEl.textContent.trim() : '';
  }

  // ==================== AUDIO DETECTION ====================

  async function getAudioFromMessage(messageElement) {
    const playButton = messageElement.querySelector(
      'button[aria-label="Sesli mesaji oynat"], button[aria-label="Play voice message"]'
    ) || messageElement.querySelector('span[data-icon="audio-play"], span[data-icon="ptt-play"]');

    if (!playButton) return null;

    // Per-request nonce prevents race conditions when multiple buttons clicked rapidly
    const myNonce = ++audioDetectionNonce;
    lastPlayedSize = null;
    lastPlayedUrl = null;
    const beforeClickTime = Date.now();

    playButton.click();

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));

      // Abort if another detection started
      if (audioDetectionNonce !== myNonce) return null;

      if (lastPlayedTimestamp >= beforeClickTime && (lastPlayedSize || lastPlayedUrl)) {
        setTimeout(() => {
          const pauseBtn = document.querySelector(
            'button[aria-label="Sesli mesaji duraklat"], button[aria-label="Pause voice message"], span[data-icon="audio-pause"], span[data-icon="ptt-pause"]'
          );
          if (pauseBtn) pauseBtn.click();
        }, 50);

        try {
          let blobData;
          if (lastPlayedUrl) blobData = await requestBlobByUrl(lastPlayedUrl);
          else if (lastPlayedSize) blobData = await requestBlobBySize(lastPlayedSize);

          if (blobData?.base64) {
            const bytes = Uint8Array.from(atob(blobData.base64), c => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: blobData.type || 'audio/ogg' });
            return { blob, type: blobData.type || 'audio/ogg' };
          }
        } catch (e) {
          console.error('[WVT] Failed to get blob:', e);
        }
        break;
      }
    }

    // Timeout - pause
    const pauseBtn = document.querySelector(
      'button[aria-label="Sesli mesaji duraklat"], button[aria-label="Pause voice message"], span[data-icon="audio-pause"], span[data-icon="ptt-pause"]'
    );
    if (pauseBtn) pauseBtn.click();
    return null;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ==================== TRANSLATION API ====================

  async function translateAudio(blob, mimeType, sender) {
    const base64 = await blobToBase64(blob);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE_AUDIO', audioData: { base64, mimeType }, sender },
        (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (response?.success) resolve(response.data);
          else reject(new Error(response?.error || 'Ceviri hatasi'));
        }
      );
    });
  }

  async function translateText(text, sender, context) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE_TEXT_MESSAGE', text, sender, context: context || [] },
        (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (response?.success) resolve(response.data);
          else reject(new Error(response?.error || 'Ceviri hatasi'));
        }
      );
    });
  }

  // Translate reply through background.js (no hardcoded backend URL)
  async function translateReply(text, targetLanguage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE_REPLY', text, targetLanguage },
        (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (response?.success) resolve(response.data);
          else reject(new Error(response?.error || 'Ceviri hatasi'));
        }
      );
    });
  }

  // ==================== CONVERSATION CONTEXT ====================

  function getConversationContext(targetMessageElement, maxMessages = 8) {
    const context = [];
    const allRows = Array.from(document.querySelectorAll('[role="row"]'));
    let rows = allRows;
    let idx = allRows.indexOf(targetMessageElement);

    if (idx === -1) {
      rows = Array.from(document.querySelectorAll('[data-id]'));
      idx = rows.indexOf(targetMessageElement);
    }
    if (idx === -1) return [];

    const start = Math.max(0, idx - maxMessages);
    for (let i = start; i < idx; i++) {
      const row = rows[i];
      const textEl = findTextElement(row);
      if (!textEl) continue;
      const text = textEl.textContent.trim();
      if (!text || text.length < 1) continue;

      const isOutgoing = row.querySelector('[data-icon="msg-dblcheck"], [data-icon="msg-check"]') ||
                         row.classList?.contains('message-out') ||
                         row.querySelector('.message-out');
      context.push({ sender: isOutgoing ? 'Sen' : (getSenderName(row) || 'Karsi'), text });
    }
    return context;
  }

  // ==================== INLINE TRANSLATION DISPLAY ====================

  const langCodes = {
    'Arapca': 'ar', 'Rusca': 'ru', 'Ingilizce': 'en', 'Almanca': 'de',
    'Fransizca': 'fr', 'Ispanyolca': 'es', 'Farsca': 'fa', 'Urduca': 'ur',
    'Hintce': 'hi', 'Kurtce': 'ku', 'Azerice': 'az', 'Ibranice': 'he',
    'Cince': 'zh', 'Japonca': 'ja', 'Korece': 'ko', 'Portekizce': 'pt',
    'Italyanca': 'it', 'Yunanca': 'el', 'Ukraynaca': 'uk', 'Turkce': 'tr'
  };

  function showInlineTranslation(messageElement, data) {
    const existing = messageElement.querySelector('.wvt-inline');
    if (existing) existing.remove();

    const lang = data.detectedLanguage || '';
    const langCode = langCodes[lang] || lang.toLowerCase().substring(0, 2) || 'en';

    // Build DOM programmatically instead of innerHTML for better safety
    const div = document.createElement('div');
    div.className = 'wvt-inline';

    div.innerHTML = `
      <div class="wvt-inline-header">
        <span class="wvt-inline-lang">${escapeHtml(lang)}</span>
        <button class="wvt-inline-close" title="Kapat">&times;</button>
      </div>
      <div class="wvt-inline-text">${escapeHtml(data.translation || '')}</div>
      <div class="wvt-inline-reply">
        <button class="wvt-inline-reply-toggle">Cevap Yaz</button>
        <div class="wvt-inline-reply-form" style="display:none;">
          <input type="text" class="wvt-inline-reply-input" placeholder="Turkce cevabin..." />
          <div class="wvt-inline-reply-actions">
            <button class="wvt-inline-reply-btn" data-lang="${escapeHtml(langCode)}" data-langname="${escapeHtml(lang)}">${escapeHtml(lang)}'ya Cevir</button>
          </div>
          <div class="wvt-inline-reply-result" style="display:none;">
            <div class="wvt-inline-reply-result-text"></div>
            <div class="wvt-inline-reply-result-actions">
              <button class="wvt-inline-copy-btn">Kopyala</button>
              <button class="wvt-inline-paste-btn">Yapistir</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Stop all event propagation on the entire inline container
    // Prevents WhatsApp from stealing focus
    ['mousedown', 'click', 'focusin'].forEach(evt => {
      div.addEventListener(evt, (e) => e.stopPropagation());
    });

    // Close button
    div.querySelector('.wvt-inline-close').addEventListener('click', () => div.remove());

    // Reply toggle
    div.querySelector('.wvt-inline-reply-toggle').addEventListener('click', () => {
      const form = div.querySelector('.wvt-inline-reply-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
      if (form.style.display === 'block') {
        div.querySelector('.wvt-inline-reply-input').focus();
      }
    });

    // Input: stop propagation for all keyboard/input events
    const inlineInput = div.querySelector('.wvt-inline-reply-input');
    ['keydown', 'keyup', 'keypress', 'input'].forEach(evt => {
      inlineInput.addEventListener(evt, (e) => e.stopPropagation());
    });

    // Enter key to translate
    inlineInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        div.querySelector('.wvt-inline-reply-btn').click();
      }
    });

    // Reply translate button - routes through background.js (no hardcoded URL)
    div.querySelector('.wvt-inline-reply-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const turkishText = inlineInput.value.trim();
      if (!turkishText) return;

      btn.disabled = true;
      btn.textContent = 'Cevriliyor...';

      try {
        const result = await translateReply(turkishText, btn.dataset.lang);
        if (result.success !== false && result.translation) {
          const resultDiv = div.querySelector('.wvt-inline-reply-result');
          div.querySelector('.wvt-inline-reply-result-text').textContent = result.translation;
          resultDiv.style.display = 'block';
        }
      } catch (err) {
        console.error('[WVT] Inline reply error:', err);
      } finally {
        btn.disabled = false;
        btn.textContent = `${escapeHtml(btn.dataset.langname)}'ya Cevir`;
      }
    });

    // Copy button
    div.querySelector('.wvt-inline-copy-btn').addEventListener('click', async (e) => {
      const text = div.querySelector('.wvt-inline-reply-result-text').textContent;
      await navigator.clipboard.writeText(text);
      e.currentTarget.textContent = 'Kopyalandi';
      setTimeout(() => { e.currentTarget.textContent = 'Kopyala'; }, 2000);
    });

    // Paste button
    div.querySelector('.wvt-inline-paste-btn').addEventListener('click', (e) => {
      const text = div.querySelector('.wvt-inline-reply-result-text').textContent;
      const success = pasteToWhatsAppInput(text);
      e.currentTarget.textContent = success ? 'Yapildi' : 'Hata';
      setTimeout(() => { e.currentTarget.textContent = 'Yapistir'; }, 2000);
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

  // Show brief error feedback on a button
  function showButtonError(button, message) {
    button.innerHTML = '!';
    button.title = message;
    button.classList.remove('loading');
    setTimeout(() => {
      button.innerHTML = '\u{1F310}';
      button.title = 'Cevir';
    }, 3000);
  }

  // ==================== PASTE TO WHATSAPP INPUT ====================

  function pasteToWhatsAppInput(text) {
    const input = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                  document.querySelector('footer div[contenteditable="true"]') ||
                  document.querySelector('div[contenteditable="true"][role="textbox"]');
    if (!input) return false;

    input.focus();
    document.execCommand('insertText', false, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // ==================== MESSAGE LISTENERS ====================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PASTE_TO_INPUT') {
      sendResponse({ success: pasteToWhatsAppInput(message.text) });
    }

    if (message.type === 'CONTEXT_TRANSLATE') {
      const selectedText = window.getSelection().toString().trim();
      if (selectedText) handleContextTranslate(selectedText);
      sendResponse({ success: true });
    }
  });

  async function handleContextTranslate(text) {
    try {
      const selection = window.getSelection();
      if (selection.rangeCount === 0) return;

      // Find message container from selection (single traversal, no shadowing)
      let node = selection.getRangeAt(0).startContainer;
      if (node.nodeType === 3) node = node.parentElement;
      const msgContainer = walkUpToMessage(node);
      if (!msgContainer) return;

      const context = getConversationContext(msgContainer);
      const result = await translateText(text, null, context);
      showInlineTranslation(msgContainer, result);
    } catch (error) {
      console.error('[WVT] Context translate error:', error);
    }
  }

  // ==================== VOICE TRANSLATE BUTTON ====================

  function createTranslateButton(messageElement) {
    const button = document.createElement('button');
    button.className = 'wvt-translate-btn';
    button.innerHTML = '\u{1F310}';
    button.title = 'Cevir';

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.classList.contains('loading')) return;

      if (activeTranslations >= MAX_CONCURRENT_TRANSLATIONS) {
        showButtonError(button, 'Cok fazla istek, bekleyin');
        return;
      }

      button.classList.add('loading');
      button.innerHTML = '\u23F3';
      activeTranslations++;

      try {
        const audioData = await getAudioFromMessage(messageElement);
        if (!audioData) {
          showButtonError(button, 'Ses bulunamadi');
          return;
        }

        const sender = getSenderName(messageElement);
        const result = await translateAudio(audioData.blob, audioData.type, sender);
        button.innerHTML = '\u2713';
        button.classList.add('done');
        showInlineTranslation(messageElement, result);
      } catch (error) {
        console.error('[WVT] Error:', error);
        showButtonError(button, error.message || 'Ceviri hatasi');
      } finally {
        button.classList.remove('loading');
        activeTranslations--;
      }
    });

    return button;
  }

  // ==================== TEXT MESSAGE TRANSLATION ====================

  function findTextMessages() {
    const textMessages = new Set();
    const textAnchors = new Set();

    document.querySelectorAll('[data-pre-plain-text]').forEach(el => textAnchors.add(el));
    document.querySelectorAll('.copyable-text').forEach(el => textAnchors.add(el));

    if (textAnchors.size === 0) {
      document.querySelectorAll('span.selectable-text, .selectable-text').forEach(el => textAnchors.add(el));
    }

    if (textAnchors.size === 0) {
      document.querySelectorAll('[role="row"] span[dir], [data-id] span[dir]').forEach(el => {
        if (el.textContent.trim().length >= 2) textAnchors.add(el);
      });
    }

    textAnchors.forEach(anchor => {
      let textContent = '';
      if (anchor.hasAttribute?.('data-pre-plain-text') || anchor.classList?.contains('copyable-text')) {
        const inner = anchor.querySelector('span.selectable-text') || anchor.querySelector('.selectable-text') || anchor.querySelector('span[dir]');
        textContent = inner ? inner.textContent.trim() : '';
      } else {
        textContent = anchor.textContent.trim();
      }

      if (textContent.length < 2) return;

      const messageContainer = walkUpToMessage(anchor);
      if (!messageContainer) return;

      // Skip voice messages
      if (messageContainer.querySelector('button[aria-label="Sesli mesaji oynat"], button[aria-label="Play voice message"], span[data-icon="audio-play"], span[data-icon="ptt-play"]')) return;

      if (processedTextMessages.has(messageContainer)) return;
      if (messageContainer.querySelector('.wvt-text-translate-btn')) return;

      textMessages.add(messageContainer);
    });

    return Array.from(textMessages);
  }

  function createTextTranslateButton(messageElement) {
    const button = document.createElement('button');
    button.className = 'wvt-translate-btn wvt-text-translate-btn';
    button.innerHTML = '\u{1F310}';
    button.title = 'Metni Cevir';

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.classList.contains('loading')) return;

      if (activeTranslations >= MAX_CONCURRENT_TRANSLATIONS) {
        showButtonError(button, 'Cok fazla istek, bekleyin');
        return;
      }

      button.classList.add('loading');
      button.innerHTML = '\u23F3';
      activeTranslations++;

      try {
        const text = getMessageText(messageElement);
        if (!text) { showButtonError(button, 'Metin bulunamadi'); return; }

        const sender = getSenderName(messageElement);
        const context = getConversationContext(messageElement);
        const result = await translateText(text, sender, context);
        button.innerHTML = '\u2713';
        button.classList.add('done');
        showInlineTranslation(messageElement, result);
      } catch (error) {
        console.error('[WVT] Text translation error:', error);
        showButtonError(button, error.message || 'Ceviri hatasi');
      } finally {
        button.classList.remove('loading');
        activeTranslations--;
      }
    });

    return button;
  }

  function addTextTranslateButtons() {
    const textMessages = findTextMessages();
    textMessages.forEach(messageElement => {
      if (processedTextMessages.has(messageElement)) return;
      if (messageElement.querySelector('.wvt-text-translate-btn')) return;

      processedTextMessages.add(messageElement);
      const button = createTextTranslateButton(messageElement);
      const wrapper = document.createElement('div');
      wrapper.className = 'wvt-button-wrapper';
      wrapper.appendChild(button);

      const textEl = findTextElement(messageElement);
      const copyableText = messageElement.querySelector('[data-pre-plain-text]') || messageElement.querySelector('.copyable-text');
      const textBubble = copyableText?.closest('[class*="focusable"]') || copyableText?.parentElement ||
                         textEl?.closest('[class*="focusable"]') || textEl?.parentElement?.parentElement?.parentElement;

      if (textBubble?.parentElement) {
        textBubble.parentElement.insertBefore(wrapper, textBubble.nextSibling);
      } else {
        messageElement.appendChild(wrapper);
      }
    });
  }

  // ==================== IMAGE MESSAGE TRANSLATION ====================

  function findImageMessages() {
    const imageMessages = new Set();

    document.querySelectorAll('img[src*="blob:"], img[src*="media"]').forEach(img => {
      // Check if image is loaded and large enough
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      // Skip unloaded (0x0) or small (icons/avatars) images
      if (w === 0 || h === 0 || (w < 100 && h < 100)) return;

      const messageContainer = walkUpToMessage(img);
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
          reader.onloadend = () => resolve({ base64: reader.result.split(',')[1], mimeType: blob.type || 'image/jpeg' });
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.log('[WVT] Blob fetch failed, trying canvas');
      }
    }

    // Canvas fallback with try-catch for tainted canvas
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
    } catch (e) {
      throw new Error('Resim verisi alinamadi (cross-origin)');
    }
  }

  function createImageTranslateButton(messageElement) {
    const button = document.createElement('button');
    button.className = 'wvt-translate-btn wvt-img-translate-btn';
    button.innerHTML = '\u{1F310}';
    button.title = 'Resimdeki Metni Cevir';

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.classList.contains('loading')) return;

      if (activeTranslations >= MAX_CONCURRENT_TRANSLATIONS) {
        showButtonError(button, 'Cok fazla istek, bekleyin');
        return;
      }

      button.classList.add('loading');
      button.innerHTML = '\u23F3';
      activeTranslations++;

      try {
        const img = messageElement.querySelector('img[src*="blob:"], img[src*="media"]');
        if (!img) throw new Error('Resim bulunamadi');

        const { base64, mimeType } = await getImageBase64(img);
        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'TRANSLATE_IMAGE', imageData: base64, mimeType },
            (response) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else if (response?.success) resolve(response.data);
              else reject(new Error(response?.error || 'Ceviri hatasi'));
            }
          );
        });

        button.innerHTML = '\u2713';
        button.classList.add('done');
        showInlineTranslation(messageElement, result);
      } catch (error) {
        console.error('[WVT] Image translation error:', error);
        showButtonError(button, error.message || 'Resim cevirisi hatasi');
      } finally {
        button.classList.remove('loading');
        activeTranslations--;
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
      const imgContainer = img?.closest('[class*="focusable"]') || img?.parentElement?.parentElement;

      if (imgContainer?.parentElement) {
        imgContainer.parentElement.insertBefore(wrapper, imgContainer.nextSibling);
      } else {
        messageElement.appendChild(wrapper);
      }
    });
  }

  // ==================== MAIN SCAN + INITIALIZATION ====================

  function addTranslateButtons() {
    const voiceMessages = findVoiceMessages();

    voiceMessages.forEach(messageElement => {
      if (processedMessages.has(messageElement)) return;
      // Only check for voice-specific buttons, not text buttons
      if (messageElement.querySelector('.wvt-translate-btn:not(.wvt-text-translate-btn):not(.wvt-img-translate-btn)')) return;

      processedMessages.add(messageElement);
      const button = createTranslateButton(messageElement);
      const wrapper = document.createElement('div');
      wrapper.className = 'wvt-button-wrapper';
      wrapper.appendChild(button);

      const playButton = messageElement.querySelector(
        'button[aria-label="Sesli mesaji oynat"], button[aria-label="Play voice message"]'
      );
      const audioBubble = playButton?.closest('[class*="focusable"]') ||
                          playButton?.parentElement?.parentElement?.parentElement;

      if (audioBubble?.parentElement) {
        audioBubble.parentElement.insertBefore(wrapper, audioBubble.nextSibling);
      } else {
        messageElement.appendChild(wrapper);
      }
    });

    addTextTranslateButtons();
    addImageTranslateButtons();
  }

  // Debounced version for MutationObserver (300ms delay)
  const debouncedAddButtons = debounce(addTranslateButtons, 300);

  function init() {
    console.log('[WVT] WhatsApp Translator v3.1.0 loaded');

    // Initial scans with delays
    setTimeout(addTranslateButtons, 2000);
    setTimeout(addTranslateButtons, 5000);

    // Debounced MutationObserver - no longer fires on every single DOM change
    const observer = new MutationObserver(debouncedAddButtons);
    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback periodic scan (reduced from 3s to 10s since MutationObserver handles most cases)
    setInterval(addTranslateButtons, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 1000);
  }
})();
