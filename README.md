# WhatsApp Voice Translator 🎤🌐

Chrome eklentisi + Node.js backend ile WhatsApp Web sesli mesajlarını otomatik olarak Türkçe'ye çevirin.

## Özellikler

- **Otomatik Dil Algılama**: Arapça, İngilizce, Almanca ve 30+ dil desteği
- **Türkçe Çeviri**: Tüm sesli mesajlar Türkçe'ye çevrilir
- **Cevap Çevirisi**: Türkçe cevabınızı karşı tarafa onların dilinde gönderin
- **Side Panel**: Tüm çeviriler yan panelde listelenir
- **Gemini AI**: Google'ın en gelişmiş AI modeli (2.5 Flash) ile yüksek kaliteli çeviri

## Nasıl Çalışır?

1. WhatsApp Web'deki ses mesajlarının yanına "🌐" butonu eklenir
2. Butona tıklayınca ses dosyası backend'e gönderilir
3. **Google Gemini 2.5 Flash** ile dil algılama + transkripsiyon + çeviri tek seferde yapılır
4. Çeviri yan panelde gösterilir
5. İsterseniz Türkçe cevabınızı karşı tarafın diline çevirebilirsiniz

## Kurulum

### 1. Backend Kurulumu

```bash
cd backend
npm install
```

**.env dosyası oluşturun:**
```
GEMINI_API_KEY=your-gemini-api-key
PORT=3456
```

> 💡 Gemini API key almak için: https://aistudio.google.com/apikey (Ücretsiz!)

**Backend'i başlatın:**
```bash
npm start
```

Başarılı olursa:
```
╔════════════════════════════════════════════════════════╗
║     WhatsApp Voice Translator Backend (Gemini)         ║
╠════════════════════════════════════════════════════════╣
║  🚀 Server running on http://localhost:3456            ║
║  📡 Waiting for translation requests...                ║
║  🤖 Model: Gemini 2.5 Flash                            ║
╚════════════════════════════════════════════════════════╝
```

### 2. Chrome Eklentisi Kurulumu

1. Chrome'da `chrome://extensions` adresine gidin
2. Sağ üstten **"Geliştirici modu"** açın
3. **"Paketlenmemiş öğe yükle"** butonuna tıklayın
4. `extension` klasörünü seçin

### 3. Kullanım

1. Backend'in çalıştığından emin olun
2. https://web.whatsapp.com adresine gidin
3. Sesli mesajın yanındaki **🌐** butonuna tıklayın
4. Yan panelde çeviri görünecek
5. "Cevap Yaz" ile Türkçe cevabınızı karşı tarafa çevirin

## Proje Yapısı

```
wptranslate/
├── extension/           # Chrome eklentisi
│   ├── manifest.json    # Manifest V3 ayarları
│   ├── content.js       # UI ve Chrome runtime iletişimi
│   ├── interceptor.js   # Audio blob yakalama (MAIN world)
│   ├── background.js    # Service worker
│   ├── sidepanel.html   # Yan panel HTML
│   ├── sidepanel.js     # Yan panel mantığı
│   ├── styles.css       # Stiller
│   └── icon.png         # Eklenti ikonu
├── backend/             # Node.js sunucu
│   ├── server.js        # Express + Gemini AI
│   ├── package.json     # Bağımlılıklar
│   └── .env             # API key (gitignore'da)
└── README.md
```

## API Endpoints

### POST /translate
Ses dosyasını çevirir.

```bash
curl -X POST http://localhost:3456/translate \
  -F "audio=@voice_message.ogg"

# Yanıt
{
  "success": true,
  "original": "مرحبا كيف حالكم",
  "translation": "Merhaba, nasılsınız?",
  "detectedLanguage": "Arapça",
  "processingTime": "1.2s"
}
```

### POST /translate-text
Türkçe metni hedef dile çevirir (cevap için).

```bash
curl -X POST http://localhost:3456/translate-text \
  -H "Content-Type: application/json" \
  -d '{"text": "Evet, var", "targetLanguage": "ar"}'

# Yanıt
{
  "success": true,
  "original": "Evet, var",
  "translation": "نعم، يوجد",
  "targetLanguage": "Arapça"
}
```

## Desteklenen Diller

Arapça, İngilizce, Almanca, Fransızca, İspanyolca, Rusça, Çince, Japonca, Korece, Farsça, Urduca, Hintçe, Kürtçe, Azerice, İbranice, Portekizce, İtalyanca, Hollandaca, Lehçe, Ukraynaca, Yunanca, Romence, Bulgarca, Sırpça, Hırvatça, Boşnakça, Arnavutça ve daha fazlası...

## Maliyet

Google Gemini API çok uygun fiyatlı:
- **Gemini 2.5 Flash**: ~$0.075/1M input token
- Ortalama ses mesajı çevirisi: **< $0.001**

## Lisans

MIT License
