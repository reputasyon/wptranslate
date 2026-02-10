// WhatsApp Voice Translator - Background Service Worker
// v3.1.0 - Auth, timeout, centralized API calls

const BACKEND_URL = 'http://localhost:3456';
const FETCH_TIMEOUT_MS = 35000;

// Optional API token - set this if WVT_API_TOKEN is configured in backend/.env
const WVT_API_TOKEN = '';

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (WVT_API_TOKEN) headers['X-WVT-Token'] = WVT_API_TOKEN;
  return headers;
}

// Fetch with timeout via AbortController
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Create context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'wvt-translate',
    title: "Turkce'ye Cevir",
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
    await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
  }
});

// Handle messages from content script and side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TRANSLATE_AUDIO') {
    notifySidePanel({ type: 'TRANSLATION_STARTED', data: request.sender || {} });

    handleAudioTranslation(request.audioData, request.sender)
      .then(result => {
        notifySidePanel({
          type: 'TRANSLATION_RESULT',
          data: { original: result.original, translation: result.translation, detectedLanguage: result.detectedLanguage, sender: request.sender }
        });
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        notifySidePanel({ type: 'TRANSLATION_ERROR', data: { error: error.message } });
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.type === 'TRANSLATE_TEXT_MESSAGE') {
    notifySidePanel({ type: 'TRANSLATION_STARTED', data: request.sender || {} });

    handleTextTranslation(request.text, request.sender, request.context)
      .then(result => {
        notifySidePanel({
          type: 'TRANSLATION_RESULT',
          data: { original: result.original, translation: result.translation, detectedLanguage: result.detectedLanguage, sender: request.sender }
        });
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        notifySidePanel({ type: 'TRANSLATION_ERROR', data: { error: error.message } });
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.type === 'TRANSLATE_IMAGE') {
    handleImageTranslation(request.imageData, request.mimeType)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Centralized reply translation (used by content.js inline reply + sidepanel.js)
  if (request.type === 'TRANSLATE_REPLY') {
    handleReplyTranslation(request.text, request.targetLanguage)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'PASTE_TO_INPUT') {
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
    // Null check: sender.tab may be undefined if message comes from non-tab context
    const windowId = sender?.tab?.windowId;
    if (windowId) {
      chrome.sidePanel.open({ windowId });
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'No window context' });
    }
    return true;
  }
});

async function notifySidePanel(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (e) {
    // Side panel might not be open
  }
}

async function handleAudioTranslation(audioData, senderInfo) {
  // Efficient base64 to Uint8Array conversion
  const binaryString = atob(audioData.base64);
  const bytes = Uint8Array.from(binaryString, c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: audioData.mimeType || 'audio/ogg' });

  const formData = new FormData();
  formData.append('audio', blob, `voice_${Date.now()}.ogg`);

  const fetchOptions = { method: 'POST', body: formData };
  if (WVT_API_TOKEN) fetchOptions.headers = { 'X-WVT-Token': WVT_API_TOKEN };

  const response = await fetchWithTimeout(`${BACKEND_URL}/translate`, fetchOptions);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return await response.json();
}

async function handleTextTranslation(text, senderInfo, context) {
  const response = await fetchWithTimeout(`${BACKEND_URL}/translate-message`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ text, context: context || [] })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return await response.json();
}

async function handleImageTranslation(base64Image, mimeType) {
  const response = await fetchWithTimeout(`${BACKEND_URL}/translate-image`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ image: base64Image, mimeType: mimeType || 'image/jpeg' })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return await response.json();
}

async function handleReplyTranslation(text, targetLanguage) {
  const response = await fetchWithTimeout(`${BACKEND_URL}/translate-text`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ text, targetLanguage })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return await response.json();
}

console.log('[WVT] Background service worker v3.1.0');
