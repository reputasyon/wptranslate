// WhatsApp Voice Translator - Background Service Worker
// v3.0.0 - Inline translation + Context menu + Paste

const BACKEND_URL = 'http://localhost:3456';

// Create context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'wvt-translate',
    title: "Türkçe'ye Çevir",
    contexts: ['selection'],
    documentUrlPatterns: ['https://web.whatsapp.com/*']
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'wvt-translate' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_TRANSLATE' });
  }
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Enable side panel for WhatsApp
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab.url) return;

  if (tab.url.includes('web.whatsapp.com')) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true
    });
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TRANSLATE_AUDIO') {
    // Notify side panel that translation started
    notifySidePanel({ type: 'TRANSLATION_STARTED', data: request.sender || {} });

    handleTranslation(request.audioData, request.sender)
      .then(result => {
        // Notify side panel with result
        notifySidePanel({
          type: 'TRANSLATION_RESULT',
          data: {
            original: result.original,
            translation: result.translation,
            detectedLanguage: result.detectedLanguage,
            sender: request.sender
          }
        });
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        // Notify side panel with error
        notifySidePanel({
          type: 'TRANSLATION_ERROR',
          data: { error: error.message }
        });
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep message channel open for async response
  }

  if (request.type === 'TRANSLATE_TEXT_MESSAGE') {
    notifySidePanel({ type: 'TRANSLATION_STARTED', data: request.sender || {} });

    handleTextTranslation(request.text, request.sender, request.context)
      .then(result => {
        notifySidePanel({
          type: 'TRANSLATION_RESULT',
          data: {
            original: result.original,
            translation: result.translation,
            detectedLanguage: result.detectedLanguage,
            sender: request.sender
          }
        });
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        notifySidePanel({
          type: 'TRANSLATION_ERROR',
          data: { error: error.message }
        });
        sendResponse({ success: false, error: error.message });
      });

    return true;
  }

  if (request.type === 'TRANSLATE_IMAGE') {
    handleImageTranslation(request.imageData, request.mimeType)
      .then(result => {
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.type === 'PASTE_TO_INPUT') {
    // Forward to WhatsApp tab content script
    chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'PASTE_TO_INPUT',
          text: request.text
        }, (response) => {
          sendResponse(response || { success: false });
        });
      } else {
        sendResponse({ success: false, error: 'WhatsApp tab not found' });
      }
    });
    return true;
  }

  if (request.type === 'OPEN_SIDE_PANEL') {
    chrome.sidePanel.open({ windowId: sender.tab.windowId });
    sendResponse({ success: true });
    return true;
  }
});

async function notifySidePanel(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (e) {
    // Side panel might not be open
    console.log('[Background] Side panel not available:', e.message);
  }
}

async function handleTranslation(audioData, senderInfo) {
  // Convert base64 to blob
  const byteCharacters = atob(audioData.base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: audioData.mimeType || 'audio/ogg' });

  // Create FormData
  const formData = new FormData();
  const filename = `voice_${Date.now()}.ogg`;
  formData.append('audio', blob, filename);

  // Send to backend
  const response = await fetch(`${BACKEND_URL}/translate`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return await response.json();
}

async function handleTextTranslation(text, senderInfo, context) {
  const response = await fetch(`${BACKEND_URL}/translate-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, context: context || [] })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return await response.json();
}

async function handleImageTranslation(base64Image, mimeType) {
  const response = await fetch(`${BACKEND_URL}/translate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image, mimeType: mimeType || 'image/jpeg' })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return await response.json();
}

console.log('[WVT Background] Service worker started v3.0.0');
