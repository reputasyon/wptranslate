// WhatsApp Voice Translator - Side Panel
// v3.1.0

const translationsContainer = document.getElementById('translations');
const emptyState = document.getElementById('emptyState');
const clearBtn = document.getElementById('clearBtn');

let translations = [];

const rtlLanguages = ['arabic', 'ar', 'hebrew', 'he', 'persian', 'fa', 'urdu', 'ur', 'Arapca', 'Ibranice', 'Farsca', 'Urduca'];

const languageCodes = {
  'Arapca': 'ar', 'arabic': 'ar', 'ar': 'ar', 'Arabic': 'ar',
  'Ingilizce': 'en', 'english': 'en', 'en': 'en', 'English': 'en',
  'Almanca': 'de', 'german': 'de', 'de': 'de', 'German': 'de',
  'Fransizca': 'fr', 'french': 'fr', 'fr': 'fr', 'French': 'fr',
  'Ispanyolca': 'es', 'spanish': 'es', 'es': 'es', 'Spanish': 'es',
  'Rusca': 'ru', 'russian': 'ru', 'ru': 'ru', 'Russian': 'ru',
  'Cince': 'zh', 'chinese': 'zh', 'zh': 'zh', 'Chinese': 'zh',
  'Japonca': 'ja', 'japanese': 'ja', 'ja': 'ja', 'Japanese': 'ja',
  'Korece': 'ko', 'korean': 'ko', 'ko': 'ko', 'Korean': 'ko',
  'Farsca': 'fa', 'persian': 'fa', 'fa': 'fa', 'Persian': 'fa',
  'Urduca': 'ur', 'urdu': 'ur', 'ur': 'ur', 'Urdu': 'ur',
  'Hintce': 'hi', 'hindi': 'hi', 'hi': 'hi', 'Hindi': 'hi',
  'Turkce': 'tr', 'turkish': 'tr', 'tr': 'tr', 'Turkish': 'tr',
  'Kurtce': 'ku', 'kurdish': 'ku', 'ku': 'ku', 'Kurdish': 'ku',
  'Azerice': 'az', 'azerbaijani': 'az', 'az': 'az', 'Azerbaijani': 'az',
  'Ibranice': 'he', 'hebrew': 'he', 'he': 'he', 'Hebrew': 'he',
  'Portekizce': 'pt', 'portuguese': 'pt', 'pt': 'pt', 'Portuguese': 'pt',
  'Italyanca': 'it', 'italian': 'it', 'it': 'it', 'Italian': 'it',
  'Hollandaca': 'nl', 'dutch': 'nl', 'nl': 'nl', 'Dutch': 'nl',
  'Lehce': 'pl', 'polish': 'pl', 'pl': 'pl', 'Polish': 'pl',
  'Ukraynaca': 'uk', 'ukrainian': 'uk', 'uk': 'uk', 'Ukrainian': 'uk',
  'Yunanca': 'el', 'greek': 'el', 'el': 'el', 'Greek': 'el'
};

// Script-based language inference (shared logic)
function inferLanguageFromScript(text) {
  if (!text) return null;
  if (/[\u0600-\u06FF]/.test(text)) {
    if (/[\u067E\u0686\u0698\u06AF]/.test(text)) return 'Farsca';
    if (/[\u0679\u0688\u0691\u06BA]/.test(text)) return 'Urduca';
    return 'Arapca';
  }
  if (/[\u0400-\u04FF]/.test(text)) {
    if (/[\u0404\u0406\u0407\u0490\u0491]/.test(text)) return 'Ukraynaca';
    return 'Rusca';
  }
  if (/[\u0590-\u05FF]/.test(text)) return 'Ibranice';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'Cince';
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'Japonca';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'Korece';
  if (/[gsiGSI]/.test(text)) return 'Turkce';
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRANSLATION_STARTED') showLoading(message.data);
  else if (message.type === 'TRANSLATION_RESULT') showTranslation(message.data);
  else if (message.type === 'TRANSLATION_ERROR') showError(message.data);
});

function showLoading(data) {
  hideEmptyState();
  const existingLoading = document.querySelector('.loading-card');
  if (existingLoading) existingLoading.remove();

  const loadingCard = document.createElement('div');
  loadingCard.className = 'loading-card';
  loadingCard.id = 'loadingCard';
  loadingCard.innerHTML = `<div class="loading-spinner"></div><div class="loading-text">Cevriliyor...</div>`;
  translationsContainer.insertBefore(loadingCard, translationsContainer.firstChild);
}

function showTranslation(data) {
  hideEmptyState();
  const loadingCard = document.getElementById('loadingCard');
  if (loadingCard) loadingCard.remove();

  const card = document.createElement('div');
  card.className = 'translation-card';

  const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  let detectedLang = data.detectedLanguage || 'Unknown';
  let replyLang = detectedLang;
  let displayLang = detectedLang;

  if (detectedLang === 'Bilinmiyor' || detectedLang === 'Unknown' || !languageCodes[detectedLang]) {
    const inferredLang = inferLanguageFromScript(data.original || '');
    if (inferredLang) {
      replyLang = inferredLang;
      displayLang = inferredLang;
    } else {
      replyLang = null;
      displayLang = 'Bilinmiyor';
    }
  }

  const isRtl = rtlLanguages.some(lang => detectedLang.toLowerCase().includes(lang.toLowerCase()));
  const cardId = 'card_' + Date.now();

  card.id = cardId;
  card.dataset.language = detectedLang;

  card.innerHTML = `
    <div class="card-header">
      <span class="card-sender">${escapeHtml(data.sender || 'Mesaj')}<span class="language-badge">${escapeHtml(displayLang)}</span></span>
      <span class="card-time">${time}</span>
    </div>
    <div class="original-label">Orijinal</div>
    <div class="original-text ${isRtl ? 'rtl' : ''}">${escapeHtml(data.original || '')}</div>
    <div class="translated-label">Turkce</div>
    <div class="translated-text">${escapeHtml(data.translation || '')}</div>

    <div class="reply-section">
      <button class="reply-toggle" data-card="${cardId}">Cevap Yaz</button>
      <div class="reply-form" id="reply-form-${cardId}">
        <textarea class="reply-input" id="reply-input-${cardId}" placeholder="Turkce cevabin..."></textarea>
        <div class="reply-actions">
          ${replyLang ? `
            <button class="reply-btn" data-card="${cardId}" data-lang="${escapeHtml(replyLang)}">
              ${escapeHtml(replyLang)}'ya Cevir
            </button>
          ` : `
            <select class="lang-select" id="lang-select-${cardId}">
              <option value="ar">Arapca</option>
              <option value="en">Ingilizce</option>
              <option value="ru">Rusca</option>
              <option value="de">Almanca</option>
              <option value="fr">Fransizca</option>
              <option value="fa">Farsca</option>
              <option value="ur">Urduca</option>
              <option value="ku">Kurtce</option>
              <option value="az">Azerice</option>
            </select>
            <button class="reply-btn-manual" data-card="${cardId}">Cevir</button>
          `}
        </div>
        <div class="reply-result" id="reply-result-${cardId}">
          <div class="reply-result-label" id="reply-label-${cardId}">Ceviri</div>
          <div class="reply-result-text" id="reply-text-${cardId}"></div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button class="copy-btn" data-card="${cardId}">Kopyala</button>
            <button class="paste-btn" data-card="${cardId}">Yapistir</button>
          </div>
        </div>
      </div>
    </div>
  `;

  translationsContainer.insertBefore(card, translationsContainer.firstChild);

  card.querySelector('.reply-toggle').addEventListener('click', () => toggleReply(cardId));
  card.querySelector('.copy-btn').addEventListener('click', (e) => copyToClipboard(cardId, e.target));
  card.querySelector('.paste-btn').addEventListener('click', (e) => pasteToInput(cardId, e.target));

  if (replyLang) {
    card.querySelector('.reply-btn').addEventListener('click', (e) => translateReply(cardId, replyLang, e.target));
  } else {
    card.querySelector('.reply-btn-manual').addEventListener('click', (e) => {
      const select = document.getElementById(`lang-select-${cardId}`);
      const selectedLang = select.value;
      const langNames = { ar: 'Arapca', en: 'Ingilizce', ru: 'Rusca', de: 'Almanca', fr: 'Fransizca', fa: 'Farsca', ur: 'Urduca', ku: 'Kurtce', az: 'Azerice' };
      translateReply(cardId, langNames[selectedLang] || selectedLang, e.target);
    });
  }

  translations.push({ ...data, cardId });
  clearBtn.style.display = 'flex';
}

function toggleReply(cardId) {
  const form = document.getElementById(`reply-form-${cardId}`);
  if (form) {
    form.classList.toggle('active');
    if (form.classList.contains('active')) {
      document.getElementById(`reply-input-${cardId}`)?.focus();
    }
  }
}

// Routes through background.js instead of direct fetch to backend
async function translateReply(cardId, targetLanguage, btnElement) {
  const input = document.getElementById(`reply-input-${cardId}`);
  const resultDiv = document.getElementById(`reply-result-${cardId}`);
  const resultText = document.getElementById(`reply-text-${cardId}`);

  if (!input || !input.value.trim()) return;

  const turkishText = input.value.trim();
  let effectiveLang = targetLanguage;

  // If language is truly unknown, show dropdown instead of silently defaulting
  if (!effectiveLang || effectiveLang === 'Bilinmiyor' || effectiveLang === 'Unknown') {
    effectiveLang = 'Arapca';
  }

  const targetLangCode = languageCodes[effectiveLang] || effectiveLang.toLowerCase();

  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = 'Cevriliyor...';
  }

  try {
    // Route through background.js - no hardcoded backend URL
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE_REPLY', text: turkishText, targetLanguage: targetLangCode },
        (resp) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(resp);
        }
      );
    });

    if (response?.success && response.data?.translation) {
      resultText.textContent = response.data.translation;
      resultDiv.classList.add('active');
    } else {
      throw new Error(response?.error || 'Ceviri basarisiz');
    }
  } catch (error) {
    console.error('[SidePanel] Reply translation error:', error);
    resultText.textContent = 'Hata: ' + error.message;
    resultDiv.classList.add('active');
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = `${effectiveLang}'ya Cevir`;
    }
  }
}

async function pasteToInput(cardId, btnElement) {
  const resultText = document.getElementById(`reply-text-${cardId}`);
  if (!resultText?.textContent) return;

  try {
    chrome.runtime.sendMessage({ type: 'PASTE_TO_INPUT', text: resultText.textContent }, (response) => {
      btnElement.textContent = response?.success ? 'Yapildi' : 'Hata';
      setTimeout(() => { btnElement.textContent = 'Yapistir'; }, 2000);
    });
  } catch (err) {
    console.error('[SidePanel] Paste failed:', err);
  }
}

async function copyToClipboard(cardId, btnElement) {
  const resultText = document.getElementById(`reply-text-${cardId}`);
  if (!resultText?.textContent) return;

  try {
    await navigator.clipboard.writeText(resultText.textContent);
    btnElement.classList.add('copied');
    btnElement.textContent = 'Kopyalandi';
    setTimeout(() => { btnElement.classList.remove('copied'); btnElement.textContent = 'Kopyala'; }, 2000);
  } catch (err) {
    console.error('[SidePanel] Copy failed:', err);
  }
}

function showError(data) {
  const loadingCard = document.getElementById('loadingCard');
  if (loadingCard) loadingCard.remove();

  const errorCard = document.createElement('div');
  errorCard.className = 'error-card';
  errorCard.innerHTML = `<div class="error-text">${escapeHtml(data.error || 'Bir hata olustu')}</div>`;
  translationsContainer.insertBefore(errorCard, translationsContainer.firstChild);

  setTimeout(() => {
    if (errorCard.parentNode) errorCard.remove();
    if (translations.length === 0) showEmptyState();
  }, 5000);
}

function hideEmptyState() { if (emptyState) emptyState.style.display = 'none'; }
function showEmptyState() { if (emptyState) emptyState.style.display = 'flex'; }

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

clearBtn.addEventListener('click', () => {
  translations = [];
  translationsContainer.innerHTML = '';
  translationsContainer.appendChild(emptyState);
  showEmptyState();
  clearBtn.style.display = 'none';
});

// ==================== QUICK TRANSLATE ====================

const quickToggle = document.getElementById('quickToggle');
const quickForm = document.getElementById('quickForm');
const quickInput = document.getElementById('quickInput');
const quickLang = document.getElementById('quickLang');
const quickBtn = document.getElementById('quickBtn');
const quickResult = document.getElementById('quickResult');
const quickResultText = document.getElementById('quickResultText');
const quickCopy = document.getElementById('quickCopy');
const quickPaste = document.getElementById('quickPaste');

// Persist last selected language
const savedLang = localStorage.getItem('wvt-quick-lang');
if (savedLang && quickLang) quickLang.value = savedLang;

quickToggle.addEventListener('click', () => {
  quickToggle.classList.toggle('active');
  quickForm.classList.toggle('active');
  if (quickForm.classList.contains('active')) {
    quickInput.focus();
  }
});

quickBtn.addEventListener('click', async () => {
  const text = quickInput.value.trim();
  if (!text) return;

  const targetLang = quickLang.value;
  localStorage.setItem('wvt-quick-lang', targetLang);

  quickBtn.disabled = true;
  quickBtn.textContent = 'Cevriliyor...';

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE_REPLY', text, targetLanguage: targetLang },
        (resp) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(resp);
        }
      );
    });

    if (response?.success && response.data?.translation) {
      quickResultText.textContent = response.data.translation;
      quickResult.classList.add('active');
    } else {
      throw new Error(response?.error || 'Ceviri basarisiz');
    }
  } catch (err) {
    quickResultText.textContent = 'Hata: ' + err.message;
    quickResult.classList.add('active');
  } finally {
    quickBtn.disabled = false;
    quickBtn.textContent = 'Cevir';
  }
});

// Enter key in textarea (Ctrl+Enter or Cmd+Enter to translate)
quickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    quickBtn.click();
  }
});

quickCopy.addEventListener('click', async () => {
  if (!quickResultText.textContent) return;
  await navigator.clipboard.writeText(quickResultText.textContent);
  quickCopy.textContent = 'Kopyalandi';
  setTimeout(() => { quickCopy.textContent = 'Kopyala'; }, 2000);
});

quickPaste.addEventListener('click', () => {
  if (!quickResultText.textContent) return;
  chrome.runtime.sendMessage({ type: 'PASTE_TO_INPUT', text: quickResultText.textContent }, (response) => {
    quickPaste.textContent = response?.success ? 'Yapildi' : 'Hata';
    setTimeout(() => { quickPaste.textContent = 'Yapistir'; }, 2000);
  });
});

console.log('[SidePanel] v3.1.0 loaded');
