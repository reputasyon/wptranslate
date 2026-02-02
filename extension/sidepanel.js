// WhatsApp Voice Translator - Side Panel
// v2.0.1 - Gemini AI + Reply translation fix

const translationsContainer = document.getElementById('translations');
const emptyState = document.getElementById('emptyState');
const clearBtn = document.getElementById('clearBtn');

let translations = [];

// RTL languages
const rtlLanguages = ['arabic', 'ar', 'hebrew', 'he', 'persian', 'fa', 'urdu', 'ur', 'Arapça', 'İbranice', 'Farsça', 'Urduca'];

// Language codes for translation (comprehensive list)
const languageCodes = {
  // Arabic
  'Arapça': 'ar', 'arabic': 'ar', 'ar': 'ar', 'Arabic': 'ar',
  // English
  'İngilizce': 'en', 'english': 'en', 'en': 'en', 'English': 'en',
  // German
  'Almanca': 'de', 'german': 'de', 'de': 'de', 'German': 'de',
  // French
  'Fransızca': 'fr', 'french': 'fr', 'fr': 'fr', 'French': 'fr',
  // Spanish
  'İspanyolca': 'es', 'spanish': 'es', 'es': 'es', 'Spanish': 'es',
  // Russian
  'Rusça': 'ru', 'russian': 'ru', 'ru': 'ru', 'Russian': 'ru',
  // Chinese
  'Çince': 'zh', 'chinese': 'zh', 'zh': 'zh', 'Chinese': 'zh',
  // Japanese
  'Japonca': 'ja', 'japanese': 'ja', 'ja': 'ja', 'Japanese': 'ja',
  // Korean
  'Korece': 'ko', 'korean': 'ko', 'ko': 'ko', 'Korean': 'ko',
  // Persian
  'Farsça': 'fa', 'persian': 'fa', 'fa': 'fa', 'Persian': 'fa',
  // Urdu
  'Urduca': 'ur', 'urdu': 'ur', 'ur': 'ur', 'Urdu': 'ur',
  // Hindi
  'Hintçe': 'hi', 'hindi': 'hi', 'hi': 'hi', 'Hindi': 'hi',
  // Turkish
  'Türkçe': 'tr', 'turkish': 'tr', 'tr': 'tr', 'Turkish': 'tr',
  // Kurdish
  'Kürtçe': 'ku', 'kurdish': 'ku', 'ku': 'ku', 'Kurdish': 'ku',
  // Azerbaijani
  'Azerice': 'az', 'azerbaijani': 'az', 'az': 'az', 'Azerbaijani': 'az',
  // Hebrew
  'İbranice': 'he', 'hebrew': 'he', 'he': 'he', 'Hebrew': 'he',
  // Portuguese
  'Portekizce': 'pt', 'portuguese': 'pt', 'pt': 'pt', 'Portuguese': 'pt',
  // Italian
  'İtalyanca': 'it', 'italian': 'it', 'it': 'it', 'Italian': 'it',
  // Dutch
  'Hollandaca': 'nl', 'dutch': 'nl', 'nl': 'nl', 'Dutch': 'nl',
  // Polish
  'Lehçe': 'pl', 'polish': 'pl', 'pl': 'pl', 'Polish': 'pl',
  // Ukrainian
  'Ukraynaca': 'uk', 'ukrainian': 'uk', 'uk': 'uk', 'Ukrainian': 'uk',
  // Greek
  'Yunanca': 'el', 'greek': 'el', 'el': 'el', 'Greek': 'el'
};

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[SidePanel] Received message:', message.type);

  if (message.type === 'TRANSLATION_STARTED') {
    showLoading(message.data);
  } else if (message.type === 'TRANSLATION_RESULT') {
    showTranslation(message.data);
  } else if (message.type === 'TRANSLATION_ERROR') {
    showError(message.data);
  }
});

function showLoading(data) {
  hideEmptyState();

  const existingLoading = document.querySelector('.loading-card');
  if (existingLoading) existingLoading.remove();

  const loadingCard = document.createElement('div');
  loadingCard.className = 'loading-card';
  loadingCard.id = 'loadingCard';
  loadingCard.innerHTML = `
    <div class="loading-spinner"></div>
    <div class="loading-text">Çevriliyor...</div>
  `;

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

  // If language is unknown, try to detect from script
  if (detectedLang === 'Bilinmiyor' || detectedLang === 'Unknown' || !languageCodes[detectedLang]) {
    const originalText = data.original || '';
    let inferredLang = null;

    if (/[\u0600-\u06FF]/.test(originalText)) {
      inferredLang = 'Arapça';
    } else if (/[\u0400-\u04FF]/.test(originalText)) {
      inferredLang = 'Rusça';
    } else if (/[\u0590-\u05FF]/.test(originalText)) {
      inferredLang = 'İbranice';
    } else if (/[\u4E00-\u9FFF]/.test(originalText)) {
      inferredLang = 'Çince';
    } else if (/[\u3040-\u309F\u30A0-\u30FF]/.test(originalText)) {
      inferredLang = 'Japonca';
    } else if (/[\uAC00-\uD7AF]/.test(originalText)) {
      inferredLang = 'Korece';
    } else if (/[ğüşıöçĞÜŞİÖÇ]/.test(originalText)) {
      inferredLang = 'Türkçe';
    }

    if (inferredLang) {
      replyLang = inferredLang;
      displayLang = inferredLang; // Show inferred language in UI too
      console.log(`[SidePanel] Language inferred from script: ${inferredLang}`);
    } else {
      replyLang = 'Arapça';
      displayLang = 'Arapça'; // Default fallback
      console.log(`[SidePanel] Language unknown, defaulting to Arabic`);
    }
  }

  const isRtl = rtlLanguages.some(lang => detectedLang.toLowerCase().includes(lang.toLowerCase()));
  const cardId = 'card_' + Date.now();

  card.id = cardId;
  card.dataset.language = detectedLang;

  card.innerHTML = `
    <div class="card-header">
      <span class="card-sender">${escapeHtml(data.sender || 'Ses Mesajı')}<span class="language-badge">${escapeHtml(displayLang)}</span></span>
      <span class="card-time">${time}</span>
    </div>
    <div class="original-label">🗣️ Orijinal</div>
    <div class="original-text ${isRtl ? 'rtl' : ''}">${escapeHtml(data.original || '')}</div>
    <div class="translated-label">🇹🇷 Türkçe</div>
    <div class="translated-text">${escapeHtml(data.translation || '')}</div>

    <div class="reply-section">
      <button class="reply-toggle" data-card="${cardId}">
        💬 Cevap Yaz
      </button>
      <div class="reply-form" id="reply-form-${cardId}">
        <textarea class="reply-input" id="reply-input-${cardId}" placeholder="Türkçe cevabınızı yazın..."></textarea>
        <div class="reply-actions">
          <button class="reply-btn" data-card="${cardId}">
            🌐 ${escapeHtml(replyLang)}'ya Çevir
          </button>
        </div>
        <div class="reply-result" id="reply-result-${cardId}">
          <div class="reply-result-label">📤 ${escapeHtml(replyLang)} Çeviri</div>
          <div class="reply-result-text" id="reply-text-${cardId}"></div>
          <button class="copy-btn" data-card="${cardId}">📋 Kopyala</button>
        </div>
      </div>
    </div>
  `;

  translationsContainer.insertBefore(card, translationsContainer.firstChild);

  // Add event listeners
  const replyToggle = card.querySelector('.reply-toggle');
  const replyBtn = card.querySelector('.reply-btn');
  const copyBtn = card.querySelector('.copy-btn');

  replyToggle.addEventListener('click', () => toggleReply(cardId));
  replyBtn.addEventListener('click', (e) => translateReply(cardId, replyLang, e.target));
  copyBtn.addEventListener('click', (e) => copyToClipboard(cardId, e.target));

  translations.push({ ...data, cardId });
  clearBtn.style.display = 'flex';
}

function toggleReply(cardId) {
  console.log('[SidePanel] Toggle reply for:', cardId);
  const form = document.getElementById(`reply-form-${cardId}`);
  if (form) {
    form.classList.toggle('active');
    const input = document.getElementById(`reply-input-${cardId}`);
    if (input && form.classList.contains('active')) {
      input.focus();
    }
  }
}

async function translateReply(cardId, targetLanguage, btnElement) {
  console.log('[SidePanel] Translate reply:', cardId, targetLanguage);

  const input = document.getElementById(`reply-input-${cardId}`);
  const resultDiv = document.getElementById(`reply-result-${cardId}`);
  const resultText = document.getElementById(`reply-text-${cardId}`);

  if (!input || !input.value.trim()) {
    console.log('[SidePanel] No input text');
    return;
  }

  const turkishText = input.value.trim();

  // Default to Arabic if language is unknown
  let effectiveLang = targetLanguage;
  if (targetLanguage === 'Bilinmiyor' || targetLanguage === 'Unknown' || !targetLanguage) {
    effectiveLang = 'Arapça';
    console.log('[SidePanel] Unknown language, defaulting to Arabic');
  }

  const targetLangCode = languageCodes[effectiveLang] || effectiveLang.toLowerCase();

  console.log('[SidePanel] Translating to:', targetLangCode);

  // Show loading
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = '⏳ Çevriliyor...';
  }

  try {
    const response = await fetch('http://localhost:3456/translate-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: turkishText,
        targetLanguage: targetLangCode
      })
    });

    const data = await response.json();
    console.log('[SidePanel] Translation response:', data);

    if (data.success && data.translation) {
      resultText.textContent = data.translation;
      resultDiv.classList.add('active');
    } else {
      throw new Error(data.error || 'Çeviri başarısız');
    }
  } catch (error) {
    console.error('[SidePanel] Reply translation error:', error);
    resultText.textContent = '❌ Hata: ' + error.message;
    resultDiv.classList.add('active');
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = `🌐 ${effectiveLang}'ya Çevir`;
    }
  }
}

async function copyToClipboard(cardId, btnElement) {
  const resultText = document.getElementById(`reply-text-${cardId}`);

  if (resultText && resultText.textContent) {
    try {
      await navigator.clipboard.writeText(resultText.textContent);
      if (btnElement) {
        btnElement.classList.add('copied');
        btnElement.textContent = '✅ Kopyalandı';
        setTimeout(() => {
          btnElement.classList.remove('copied');
          btnElement.textContent = '📋 Kopyala';
        }, 2000);
      }
    } catch (err) {
      console.error('[SidePanel] Copy failed:', err);
    }
  }
}

function showError(data) {
  const loadingCard = document.getElementById('loadingCard');
  if (loadingCard) loadingCard.remove();

  const errorCard = document.createElement('div');
  errorCard.className = 'error-card';
  errorCard.innerHTML = `
    <div class="error-text">❌ ${escapeHtml(data.error || 'Bir hata oluştu')}</div>
  `;

  translationsContainer.insertBefore(errorCard, translationsContainer.firstChild);

  setTimeout(() => {
    if (errorCard.parentNode) errorCard.remove();
    if (translations.length === 0) showEmptyState();
  }, 5000);
}

function hideEmptyState() {
  if (emptyState) emptyState.style.display = 'none';
}

function showEmptyState() {
  if (emptyState) emptyState.style.display = 'flex';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Clear all translations
clearBtn.addEventListener('click', () => {
  translations = [];
  translationsContainer.innerHTML = '';
  translationsContainer.appendChild(emptyState);
  showEmptyState();
  clearBtn.style.display = 'none';
});

console.log('[SidePanel] WhatsApp Voice Translator Side Panel v2.0.1 loaded');
