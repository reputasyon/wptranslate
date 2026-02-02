// WhatsApp Voice Translator - Side Panel
// v1.3.9 - Auto language detection + Reply translation

const translationsContainer = document.getElementById('translations');
const emptyState = document.getElementById('emptyState');
const clearBtn = document.getElementById('clearBtn');

let translations = [];

// RTL languages
const rtlLanguages = ['arabic', 'ar', 'hebrew', 'he', 'persian', 'fa', 'urdu', 'ur', 'Arapça', 'İbranice', 'Farsça', 'Urduca'];

// Language codes for translation
const languageCodes = {
  'Arapça': 'ar', 'arabic': 'ar', 'ar': 'ar',
  'İngilizce': 'en', 'english': 'en', 'en': 'en',
  'Almanca': 'de', 'german': 'de', 'de': 'de',
  'Fransızca': 'fr', 'french': 'fr', 'fr': 'fr',
  'İspanyolca': 'es', 'spanish': 'es', 'es': 'es',
  'Rusça': 'ru', 'russian': 'ru', 'ru': 'ru',
  'Çince': 'zh', 'chinese': 'zh', 'zh': 'zh',
  'Japonca': 'ja', 'japanese': 'ja', 'ja': 'ja',
  'Korece': 'ko', 'korean': 'ko', 'ko': 'ko',
  'Farsça': 'fa', 'persian': 'fa', 'fa': 'fa',
  'Urduca': 'ur', 'urdu': 'ur', 'ur': 'ur',
  'Hintçe': 'hi', 'hindi': 'hi', 'hi': 'hi',
  'Türkçe': 'tr', 'turkish': 'tr', 'tr': 'tr'
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

  // Remove any existing loading card
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

  // Remove loading card
  const loadingCard = document.getElementById('loadingCard');
  if (loadingCard) loadingCard.remove();

  const card = document.createElement('div');
  card.className = 'translation-card';

  const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const detectedLang = data.detectedLanguage || 'Bilinmiyor';
  const isRtl = rtlLanguages.some(lang => detectedLang.toLowerCase().includes(lang.toLowerCase()));
  const cardId = 'card_' + Date.now();

  card.id = cardId;
  card.innerHTML = `
    <div class="card-header">
      <span class="card-sender">${escapeHtml(data.sender || 'Ses Mesajı')}<span class="language-badge">${escapeHtml(detectedLang)}</span></span>
      <span class="card-time">${time}</span>
    </div>
    <div class="original-label">🗣️ Orijinal</div>
    <div class="original-text ${isRtl ? 'rtl' : ''}">${escapeHtml(data.original || '')}</div>
    <div class="translated-label">🇹🇷 Türkçe</div>
    <div class="translated-text">${escapeHtml(data.translation || '')}</div>

    <div class="reply-section">
      <button class="reply-toggle" onclick="toggleReply('${cardId}', '${escapeHtml(detectedLang)}')">
        💬 Cevap Yaz
      </button>
      <div class="reply-form" id="reply-form-${cardId}">
        <textarea class="reply-input" id="reply-input-${cardId}" placeholder="Türkçe cevabınızı yazın..."></textarea>
        <div class="reply-actions">
          <button class="reply-btn" onclick="translateReply('${cardId}', '${escapeHtml(detectedLang)}')">
            🌐 ${escapeHtml(detectedLang)}'ya Çevir
          </button>
        </div>
        <div class="reply-result" id="reply-result-${cardId}">
          <div class="reply-result-label">📤 ${escapeHtml(detectedLang)} Çeviri</div>
          <div class="reply-result-text" id="reply-text-${cardId}"></div>
          <button class="copy-btn" onclick="copyToClipboard('${cardId}')">📋 Kopyala</button>
        </div>
      </div>
    </div>
  `;

  translationsContainer.insertBefore(card, translationsContainer.firstChild);

  translations.push({ ...data, cardId });
  clearBtn.style.display = 'flex';
}

function toggleReply(cardId, language) {
  const form = document.getElementById(`reply-form-${cardId}`);
  if (form) {
    form.classList.toggle('active');
    const input = document.getElementById(`reply-input-${cardId}`);
    if (input && form.classList.contains('active')) {
      input.focus();
    }
  }
}

async function translateReply(cardId, targetLanguage) {
  const input = document.getElementById(`reply-input-${cardId}`);
  const resultDiv = document.getElementById(`reply-result-${cardId}`);
  const resultText = document.getElementById(`reply-text-${cardId}`);
  const btn = event.target;

  if (!input || !input.value.trim()) {
    return;
  }

  const turkishText = input.value.trim();
  const targetLangCode = languageCodes[targetLanguage] || targetLanguage.toLowerCase();

  // Show loading
  btn.disabled = true;
  btn.innerHTML = '⏳ Çevriliyor...';

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
    btn.disabled = false;
    btn.innerHTML = `🌐 ${targetLanguage}'ya Çevir`;
  }
}

async function copyToClipboard(cardId) {
  const resultText = document.getElementById(`reply-text-${cardId}`);
  const copyBtn = event.target;

  if (resultText && resultText.textContent) {
    try {
      await navigator.clipboard.writeText(resultText.textContent);
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '✅ Kopyalandı';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = '📋 Kopyala';
      }, 2000);
    } catch (err) {
      console.error('[SidePanel] Copy failed:', err);
    }
  }
}

function showError(data) {
  // Remove loading card
  const loadingCard = document.getElementById('loadingCard');
  if (loadingCard) loadingCard.remove();

  const errorCard = document.createElement('div');
  errorCard.className = 'error-card';
  errorCard.innerHTML = `
    <div class="error-text">❌ ${escapeHtml(data.error || 'Bir hata oluştu')}</div>
  `;

  translationsContainer.insertBefore(errorCard, translationsContainer.firstChild);

  // Auto remove after 5 seconds
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

console.log('[SidePanel] WhatsApp Voice Translator Side Panel v1.3.9 loaded');
