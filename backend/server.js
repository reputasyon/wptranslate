import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 3456;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY environment variable is required');
  console.error('   Set it in .env file or export GEMINI_API_KEY=...');
  process.exit(1);
}

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Initialize Express
const app = express();

// CORS configuration
app.use(cors({
  origin: ['https://web.whatsapp.com', 'chrome-extension://*'],
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname) || '.ogg'}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB max
  },
  fileFilter: (req, file, cb) => {
    // Accept audio, video, and octet-stream (WhatsApp uses various types)
    const allowedTypes = [
      'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm',
      'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/opus',
      'video/mp4', 'video/webm', 'video/ogg',
      'application/octet-stream', 'application/ogg'
    ];
    if (allowedTypes.includes(file.mimetype) ||
        file.mimetype.startsWith('audio/') ||
        file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      console.log(`⚠️ Rejected file type: ${file.mimetype}`);
      cb(new Error(`Geçersiz dosya türü: ${file.mimetype}`), false);
    }
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'WhatsApp Voice Translator (Gemini)',
    version: '2.0.0'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Language name mapping
const languageNames = {
  'arabic': 'Arapça', 'ar': 'Arapça',
  'english': 'İngilizce', 'en': 'İngilizce',
  'german': 'Almanca', 'de': 'Almanca',
  'french': 'Fransızca', 'fr': 'Fransızca',
  'spanish': 'İspanyolca', 'es': 'İspanyolca',
  'russian': 'Rusça', 'ru': 'Rusça',
  'chinese': 'Çince', 'zh': 'Çince',
  'japanese': 'Japonca', 'ja': 'Japonca',
  'korean': 'Korece', 'ko': 'Korece',
  'persian': 'Farsça', 'fa': 'Farsça',
  'urdu': 'Urduca', 'ur': 'Urduca',
  'hindi': 'Hintçe', 'hi': 'Hintçe',
  'turkish': 'Türkçe', 'tr': 'Türkçe',
  'kurdish': 'Kürtçe', 'ku': 'Kürtçe',
  'azerbaijani': 'Azerice', 'az': 'Azerice',
  'hebrew': 'İbranice', 'he': 'İbranice',
  'portuguese': 'Portekizce', 'pt': 'Portekizce',
  'italian': 'İtalyanca', 'it': 'İtalyanca',
  'dutch': 'Hollandaca', 'nl': 'Hollandaca',
  'polish': 'Lehçe', 'pl': 'Lehçe',
  'ukrainian': 'Ukraynaca', 'uk': 'Ukraynaca',
  'greek': 'Yunanca', 'el': 'Yunanca',
  'romanian': 'Romence', 'ro': 'Romence',
  'bulgarian': 'Bulgarca', 'bg': 'Bulgarca',
  'serbian': 'Sırpça', 'sr': 'Sırpça',
  'croatian': 'Hırvatça', 'hr': 'Hırvatça',
  'bosnian': 'Boşnakça', 'bs': 'Boşnakça',
  'albanian': 'Arnavutça', 'sq': 'Arnavutça',
  'macedonian': 'Makedonca', 'mk': 'Makedonca',
  'slovenian': 'Slovence', 'sl': 'Slovence',
  'czech': 'Çekçe', 'cs': 'Çekçe',
  'slovak': 'Slovakça', 'sk': 'Slovakça',
  'hungarian': 'Macarca', 'hu': 'Macarca',
  'swedish': 'İsveççe', 'sv': 'İsveççe',
  'norwegian': 'Norveççe', 'no': 'Norveççe',
  'danish': 'Danca', 'da': 'Danca',
  'finnish': 'Fince', 'fi': 'Fince'
};

// Main translation endpoint
app.post('/translate', upload.single('audio'), async (req, res) => {
  const startTime = Date.now();
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Ses dosyası gerekli' });
    }

    filePath = req.file.path;
    console.log(`📥 Received audio file: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);

    // Read the audio file
    const audioBuffer = fs.readFileSync(filePath);
    const base64Audio = audioBuffer.toString('base64');

    // Determine MIME type
    let mimeType = req.file.mimetype;
    if (mimeType === 'application/octet-stream' || mimeType === 'application/ogg') {
      mimeType = 'audio/ogg';
    }

    console.log('🤖 Processing with Gemini 2.0 Flash...');

    // Use Gemini 2.0 Flash for audio transcription and translation
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Audio
        }
      },
      {
        text: `Bu ses kaydını dinle ve şu formatta JSON olarak yanıtla:
{
  "detected_language": "tespit edilen dil (örn: Arabic, English, German)",
  "original_text": "orijinal dildeki transkripsiyon",
  "turkish_translation": "Türkçe çeviri"
}

Eğer ses zaten Türkçe ise, turkish_translation alanına orijinal metni yaz.
Sadece JSON formatında yanıt ver, başka açıklama ekleme.`
      }
    ]);

    const response = await result.response;
    const responseText = response.text();

    console.log('📝 Gemini response:', responseText);

    // Parse JSON response
    let parsedResponse;
    try {
      // Remove markdown code blocks if present
      let jsonText = responseText;
      if (jsonText.includes('```json')) {
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonText.includes('```')) {
        jsonText = jsonText.replace(/```\n?/g, '');
      }
      parsedResponse = JSON.parse(jsonText.trim());
    } catch (parseError) {
      console.error('❌ Failed to parse Gemini response:', parseError);
      // Try to extract info from text response
      parsedResponse = {
        detected_language: 'Unknown',
        original_text: responseText,
        turkish_translation: responseText
      };
    }

    const originalText = parsedResponse.original_text || '';
    const turkishText = parsedResponse.turkish_translation || '';
    const detectedLanguage = parsedResponse.detected_language || 'Unknown';

    console.log(`🌍 Detected language: ${detectedLanguage}`);
    console.log(`📝 Original: "${originalText.substring(0, 100)}${originalText.length > 100 ? '...' : ''}"`);
    console.log(`🇹🇷 Turkish: "${turkishText.substring(0, 100)}${turkishText.length > 100 ? '...' : ''}"`);

    if (!originalText && !turkishText) {
      return res.status(400).json({
        error: 'Ses dosyasında konuşma tespit edilemedi',
        original: '',
        translation: ''
      });
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Translation completed in ${duration}s`);

    // Get Turkish name for the language
    const turkishLangName = languageNames[detectedLanguage.toLowerCase()] || detectedLanguage;

    res.json({
      success: true,
      original: originalText,
      translation: turkishText,
      detectedLanguage: turkishLangName,
      processingTime: `${duration}s`
    });

  } catch (error) {
    console.error('❌ Translation error:', error);

    // Handle specific Gemini errors
    if (error.message?.includes('API key')) {
      return res.status(401).json({ error: 'Geçersiz Gemini API anahtarı' });
    }
    if (error.message?.includes('quota')) {
      return res.status(402).json({ error: 'Gemini API kotası dolmuş' });
    }

    res.status(500).json({
      error: error.message || 'Çeviri işlemi başarısız oldu'
    });

  } finally {
    // Clean up uploaded file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) console.error('Failed to delete temp file:', err);
      });
    }
  }
});

// Text translation endpoint (for replies)
app.post('/translate-text', express.json(), async (req, res) => {
  try {
    const { text, targetLanguage } = req.body;

    if (!text || !targetLanguage) {
      return res.status(400).json({ error: 'Metin ve hedef dil gerekli' });
    }

    console.log(`📝 Translating text to ${targetLanguage}: "${text.substring(0, 50)}..."`);

    // Language names for prompt (Turkish -> Target)
    const targetLangNames = {
      'ar': 'Arapça', 'en': 'İngilizce', 'de': 'Almanca',
      'fr': 'Fransızca', 'es': 'İspanyolca', 'ru': 'Rusça',
      'zh': 'Çince', 'ja': 'Japonca', 'ko': 'Korece',
      'fa': 'Farsça', 'ur': 'Urduca', 'hi': 'Hintçe',
      'ku': 'Kürtçe', 'az': 'Azerice', 'he': 'İbranice',
      'pt': 'Portekizce', 'it': 'İtalyanca', 'nl': 'Hollandaca',
      'pl': 'Lehçe', 'uk': 'Ukraynaca', 'el': 'Yunanca',
      'ro': 'Romence', 'bg': 'Bulgarca', 'sr': 'Sırpça',
      'hr': 'Hırvatça', 'bs': 'Boşnakça', 'sq': 'Arnavutça'
    };

    const targetLangName = targetLangNames[targetLanguage] || targetLanguage;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent([
      {
        text: `Aşağıdaki Türkçe metni ${targetLangName}'ya çevir. Sadece çeviriyi döndür, başka açıklama ekleme.

Türkçe metin: ${text}`
      }
    ]);

    const response = await result.response;
    const translation = response.text().trim();

    console.log(`✅ Translated to ${targetLangName}: "${translation.substring(0, 50)}..."`);

    res.json({
      success: true,
      original: text,
      translation: translation,
      targetLanguage: targetLangName
    });

  } catch (error) {
    console.error('❌ Text translation error:', error);
    res.status(500).json({
      error: error.message || 'Çeviri işlemi başarısız oldu'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Dosya boyutu çok büyük (max 25MB)' });
    }
    return res.status(400).json({ error: `Dosya yükleme hatası: ${err.message}` });
  }

  res.status(500).json({ error: err.message || 'Sunucu hatası' });
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     WhatsApp Voice Translator Backend (Gemini)         ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  🚀 Server running on http://localhost:${PORT}            ║`);
  console.log('║  📡 Waiting for translation requests...                ║');
  console.log('║  🤖 Model: Gemini 2.0 Flash                            ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
});
