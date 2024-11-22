require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const NodeCache = require('node-cache');
// event_handlers.js
//const { ADMIN_USER_IDS } = require('./config');
const { promisify } = require('util');
const crypto = require('crypto');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
// Hash function to generate a SHA-256 hash
function hashData(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

// Encryption and decryption setup
const algorithm = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // Must be 32 bytes (256 bits)
const ENCRYPTION_IV = process.env.ENCRYPTION_IV; // Must be 16 bytes

// Encrypt function
function encrypt(text) {
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(ENCRYPTION_KEY, 'hex'), Buffer.from(ENCRYPTION_IV, 'hex'));
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return encrypted.toString('hex');
}

// Decrypt function
function decrypt(text) {
    const encryptedText = Buffer.from(text, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(ENCRYPTION_KEY, 'hex'), Buffer.from(ENCRYPTION_IV, 'hex'));
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

// Initialize SQLite DB with connection pooling
const db = new sqlite3.Database('./bot_users.db');
db.run("PRAGMA journal_mode = WAL;"); // Enable WAL mode for better concurrency

// Promisify database operations
const dbGet = promisify(db.get.bind(db));
const dbRun = promisify(db.run.bind(db));

// Create users table if not exists
dbRun(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE,
        api_key TEXT
    )
`);
// Create start_command_usage table if not exists
dbRun(`
    CREATE TABLE IF NOT EXISTS start_command_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        timestamp TEXT
    )
`);
async function trackStartCommandUsage(userId) {
    const hashedUserId = hashData(userId.toString());

    try {
        // Insert a new record into the start_command_usage table
        await dbRun('INSERT INTO start_command_usage (user_id, timestamp) VALUES (?, ?)', [hashedUserId, new Date().toISOString()]);
        logActivity(`User (${userId}) used the /start command.`);
    } catch (err) {
        handleError(err, chatId);
    }
}
async function getStartCommandStats(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Retrieve ADMIN_USER_IDS from .env and parse into an array
    const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(',') : [];

    // Check if the user is an admin
    if (!ADMIN_USER_IDS.includes(userId.toString())) {
        bot.sendMessage(chatId, 'Sorry, this command is only available to authorized admin users.');
        return;
    }

    try {
        // Fetch the start command usage statistics
        const result = await dbGet('SELECT COUNT(*) as total_users, COUNT(DISTINCT user_id) as unique_users, MAX(timestamp) as latest_usage FROM start_command_usage');

        bot.sendMessage(chatId, `
Start command usage statistics:
Total users: ${result.total_users}
Unique users: ${result.unique_users}
Latest usage: ${new Date(result.latest_usage).toLocaleString()}
        `);
    } catch (err) {
        handleError(err, chatId);
    }
}

// Initialize cache
const cache = new NodeCache({ stdTTL: 600 }); // Cache for 10 minutes

let bot;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Rate limiting
const userRequests = {};
const MAX_REQUESTS_PER_MINUTE = 5;

function isRateLimited(userId) {
    const now = Date.now();
    if (!userRequests[userId]) {
        userRequests[userId] = { count: 1, lastReset: now };
        return false;
    }

    if (now - userRequests[userId].lastReset > 60000) {
        userRequests[userId] = { count: 1, lastReset: now };
        return false;
    }

    userRequests[userId].count++;
    return userRequests[userId].count > MAX_REQUESTS_PER_MINUTE;
}

// Function to create and start the bot
function startBot() {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

    bot.on('polling_error', (error) => {
        handleError(`Polling error: ${error}`);
        if (error.code === 'EFATAL' || error.message.includes('ECONNRESET')) {
            logActivity('Connection lost. Attempting to reconnect in 10 seconds...');
            setTimeout(() => {
                bot.stopPolling()
                    .then(() => {
                        logActivity('Stopped polling. Restarting bot...');
                        startBot();
                    })
                    .catch((stopError) => {
                        handleError(`Error stopping polling: ${stopError}`);
                        logActivity('Restarting bot anyway...');
                        startBot();
                    });
            }, 10000); // Wait for 10 seconds before reconnecting
        }
    });

    // Re-attach all event handlers
    attachEventHandlers();

    logActivity('Bot started and ready to receive messages.');
}

function attachEventHandlers() {
    let awaitingApiKey = new Set();
    let activeChats = new Map(); // Tracks active chats for /startchat
    let imageAnalysisState = new Map(); // Tracks the state of image analysis for each chat
    let audioAnalysisState = new Map(); // Tracks the state of audio analysis for each chat
    let pdfAnalysisState = new Map(); // Tracks the state of pdf analysis for each chat
    let videoAnalysisState = new Map(); // Tracks the state of video analysis for each chat

    // Handle /start command
    bot.onText(/^\/start$/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        awaitingApiKey.delete(chatId);
        activeChats.delete(chatId);
        imageAnalysisState.delete(chatId);
        audioAnalysisState.delete(chatId);
        videoAnalysisState.delete(chatId);
        pdfAnalysisState.delete(chatId);
        const hashedUserId = hashData(userId.toString());
        logActivity(`User ${msg.from.username} started the bot.`);

        try {
            // Insert a new record into the start_command_usage table
            await trackStartCommandUsage(userId);

            // Rest of the /start command handler code
            const row = await dbGet('SELECT * FROM users WHERE user_id = ?', [hashedUserId]);
            if (row) {
                bot.sendMessage(chatId, `🛡درودی دوباره!
🤖برای چت با هوش مصنوعی از دستور /startchat استفاده کن
🖼برای تحلیل تصویر از دستور /imageanalyze استفاده کن
🎙برای تحلیل صوت از دستور /audioanalyze استفاده کن
📕برای تحلیل پی دی اف از دستور /pdfanalyze استفاده کن
📺برای تحلیل ویدیو از دستور /videoanalyze استفاده کن
🔑با دستور /setkey کلید API خودت رو به‌روزرسانی کن
📚آموزش دریافت کلید API رایگان /help`);
            } else {
                bot.sendMessage(chatId, `
خوش اومدی🙌
برای استفاده از ربات ابتدا باید یک 🔑کلید API رایگان تهیه کنی.
برای 📚راهنمای دریافت رایگان کلید API از /help استفاده کن.
در نهایت با دستور /setkey کلید API خودت رو ⚙️تنظیم کن.`);
            }
        } catch (err) {
            handleError(err, chatId);
        }
    });
    // Stats
    bot.onText(/^\/fansyfn$/, getStartCommandStats);
    // Handle /startchat command
    bot.onText(/\/startchat/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        awaitingApiKey.delete(chatId);
        //activeChats.delete(chatId);
        imageAnalysisState.delete(chatId);
        audioAnalysisState.delete(chatId);
        videoAnalysisState.delete(chatId);
        pdfAnalysisState.delete(chatId);
    
        try {
            const hashedUserId = hashData(userId.toString());
            const row = await dbGet('SELECT api_key FROM users WHERE user_id = ?', [hashedUserId]);
            
            // Check if the user has an API key set
            if (!row) {
                // Inform the user that they need to set an API key first
                return bot.sendMessage(chatId, `
🔑ابتدا باید یک کلید API تنظیم کنی
⚙️از دستور /setkey استفاده کن
📚راهنما /help`);
            } 
    
            // If there's already an active chat, don't allow multiple starts
            if (activeChats.has(chatId)) {
                return bot.sendMessage(chatId, "یک چت فعال در حال حاضر وجود دارد. لطفاً پیام خود را ارسال کنید یا /endchat چت رو پایان بدید");
            }
    
            // Start a new chat session
            activeChats.set(chatId, true);
            bot.sendMessage(chatId, "چت جدید شروع شد! AI بلافاصله شروع به پاسخ دادن خواهد کرد...");
    
            // Decrypt the API key
            const decryptedApiKey = decrypt(row.api_key);
            const predefinedPrompt = `بر اساس دستور پیش فرضی با معرفی خودت  و  ارايه چند ایده فرایند رو شروع کن`;
            
    
            // Initiate AI interaction with the predefined prompt
            await generateText(chatId, decryptedApiKey, predefinedPrompt);
            
        } catch (err) {
            handleError(err, chatId);
        }
    });

    // Handle /imageanalyze command
    bot.onText(/\/imageanalyze/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const hashedUserId = hashData(userId.toString());
        awaitingApiKey.delete(chatId);
        activeChats.delete(chatId);
        //imageAnalysisState.delete(chatId);
        audioAnalysisState.delete(chatId);
        videoAnalysisState.delete(chatId);
        pdfAnalysisState.delete(chatId);

        try {
            const row = await dbGet('SELECT api_key FROM users WHERE user_id = ?', [hashedUserId]);
            if (!row) {
                return bot.sendMessage(chatId, `ابتدا باید یک کلید API تنظیم کنی. از دستور /setkey استفاده کن.
راهنما /help`);
            }

            imageAnalysisState.set(chatId, { state: 'awaitingImage' });
            bot.sendMessage(chatId, "لطفا تصویر مورد نظر خود رو برای تحلیل آپلود کنید.");
        } catch (err) {
            handleError(err, chatId);
        }
    });

    // Handle image upload for analysis
    bot.on('photo', async (msg) => {
        const chatId = msg.chat.id;
        const state = imageAnalysisState.get(chatId);

        if (state && state.state === 'awaitingImage') {
            const photo = msg.photo[msg.photo.length - 1];
            const fileLink = await bot.getFileLink(photo.file_id);

            imageAnalysisState.set(chatId, { 
                state: 'awaitingDescription',
                fileLink: fileLink
            });

            bot.sendMessage(chatId, "تصویر با موفقیت دریافت شد⛓. حالا بگو چه چیزی از این تصویر می‌خوای؟ (توضیح دلخواه خودت رو ارسال کن)");
        }
    });
    // Handle /audioanalyze command
    bot.onText(/\/audioanalyze/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const hashedUserId = hashData(userId.toString());
        awaitingApiKey.delete(chatId);
        activeChats.delete(chatId);
        imageAnalysisState.delete(chatId);
        //audioAnalysisState.delete(chatId);
        videoAnalysisState.delete(chatId);
        pdfAnalysisState.delete(chatId);

        try {
            const row = await dbGet('SELECT api_key FROM users WHERE user_id = ?', [hashedUserId]);
            if (!row) {
                return bot.sendMessage(chatId, `ابتدا باید یک کلید API تنظیم کنی. از دستور /setkey استفاده کن.
راهنما /help`);
            }
            //pdfAnalysisState.delete(chatId);
            audioAnalysisState.set(chatId, { state: 'awaitingAudio' });
            bot.sendMessage(chatId, "لطفا فایل صوتی مورد نظر خود را برای تحلیل آپلود کنید.");
        } catch (err) {
            handleError(err, chatId);
        }
    });

    // Handle audio upload for analysis
    bot.on('audio', async (msg) => {
        const chatId = msg.chat.id;
        const state = audioAnalysisState.get(chatId);

        if (state && state.state === 'awaitingAudio') {
            const audio = msg.audio; // Audio files are not in an array
            const fileLink = await bot.getFileLink(audio.file_id);

            audioAnalysisState.set(chatId, { 
                state: 'awaitingDescription',
                fileLink: fileLink
            });

            bot.sendMessage(chatId, "فایل صوتی با موفقیت دریافت شد. حالا بگو چه چیزی از این فایل صوتی می‌خوای؟ (توضیح دلخواه خودت رو ارسال کن)");
        }
    });
    // Handle /pdfanalyze command
    bot.onText(/\/pdfanalyze/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const hashedUserId = hashData(userId.toString());
        awaitingApiKey.delete(chatId);
        activeChats.delete(chatId);
        imageAnalysisState.delete(chatId);
        audioAnalysisState.delete(chatId);
        videoAnalysisState.delete(chatId);
        //pdfAnalysisState.delete(chatId);

        try {
            const row = await dbGet('SELECT api_key FROM users WHERE user_id = ?', [hashedUserId]);
            if (!row) {
                return bot.sendMessage(chatId, `ابتدا باید یک کلید API تنظیم کنی. از دستور /setkey استفاده کن.
راهنما /help`);
            }

            pdfAnalysisState.set(chatId, { state: 'awaitingPdf' });
            bot.sendMessage(chatId, "لطفا پی دی اف مورد نظر خود را برای تحلیل آپلود کنید.");
        } catch (err) {
            handleError(err, chatId);
        }
    });

    // Handle pdf upload for analysis
    bot.on('document', async (msg) => {
        const chatId = msg.chat.id;
        const state = pdfAnalysisState.get(chatId);

        if (state && state.state === 'awaitingPdf') {
            const pdf = msg.document;
            if (pdf.mime_type !== 'application/pdf') {
                bot.sendMessage(chatId, "لطفا فقط فایل PDF آپلود کنید.");
                return;
            }
            const fileLink = await bot.getFileLink(pdf.file_id);

            pdfAnalysisState.set(chatId, { 
                state: 'awaitingDescription',
                fileLink: fileLink
            });

            bot.sendMessage(chatId, "فایل پی دی اف با موفقیت دریافت شد. حالا بگو چه چیزی از این فایل پی دی اف می‌خوای؟ (توضیح دلخواه خودت رو ارسال کن)");
        }
    });
    // Handle /videoanalyze command
    bot.onText(/\/videoanalyze/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const hashedUserId = hashData(userId.toString());
        awaitingApiKey.delete(chatId);
        activeChats.delete(chatId);
        imageAnalysisState.delete(chatId);
        audioAnalysisState.delete(chatId);
        //videoAnalysisState.delete(chatId);
        pdfAnalysisState.delete(chatId);

        try {
            const row = await dbGet('SELECT api_key FROM users WHERE user_id = ?', [hashedUserId]);
            if (!row) {
                return bot.sendMessage(chatId, `ابتدا باید یک کلید API تنظیم کنی. از دستور /setkey استفاده کن.
راهنما /help`);
            }

            videoAnalysisState.set(chatId, { state: 'awaitingvideo' });
            bot.sendMessage(chatId, "لطفا ویدیو مورد نظر خود را برای تحلیل آپلود کنید.");
        } catch (err) {
            handleError(err, chatId);
        }
    });

    // Handle video upload for analysis
    bot.on('video', async (msg) => {
        const chatId = msg.chat.id;
        const state = videoAnalysisState.get(chatId);

        if (state && state.state === 'awaitingvideo') {
            const video = msg.video;
            const fileLink = await bot.getFileLink(video.file_id);

            videoAnalysisState.set(chatId, { 
                state: 'awaitingDescription',
                fileLink: fileLink
            });

            bot.sendMessage(chatId, "فایل ویدیو با موفقیت دریافت شد. حالا بگو چه چیزی از این فایل ویدیو می‌خوای؟ (توضیح دلخواه خودت رو ارسال کن)");
        }
    });      
    // Handle /help command
    bot.onText(/\/help/, (msg) => {
        const chatId = msg.chat.id;
        awaitingApiKey.delete(chatId);
        activeChats.delete(chatId);
        imageAnalysisState.delete(chatId);
        audioAnalysisState.delete(chatId);
        videoAnalysisState.delete(chatId);
        pdfAnalysisState.delete(chatId);
        const helpMessage = `
آموزش دریافت کلید API رایگان
۱- به این لینک (https://ai.google.dev/gemini-api/docs/api-key) برید
(لینک رو ترجیحا یا کروم یا مرورگر خارجی باز کنید)
۲-گوشه سمت راست بالا sign in  رو بزنید
۳- با یه حساب جیمیل وارد بشید
۴- دکمه "Get an API key" رو بزنید یه صفحه باز میشه
۵- دکمه "Get API key" رو بزنید
۶- باکس اولی رو تیک بزنید(۲تای دیگه ضروری نیست)
۷- دکمه "Create API key" رو بزنید
۸- دکمه "Create API key in new project" رو بزنید
۹- کلید API رو کپی کنید و همون موقع یجا ذخیره کنید(بعد از بستن این پنجره دیگه به کلید دسترسی نخواهید داشت)
۱۰- اونو با دستور /setkey در ربات تنظیم کن`;

        bot.sendMessage(chatId, helpMessage);
        // Forward the video from the channel
        const channelId = '-1002332416831';  // Replace with your channel ID
        const messageId = 3;  // Replace with the actual message ID of the video
        // Forwarding video file
        bot.copyMessage(chatId, channelId, messageId);
        logActivity(`User ${msg.from.username} requested help.`);
    });

    // Handle /setkey command
    bot.onText(/\/setkey/, (msg) => {
        const chatId = msg.chat.id;
        //awaitingApiKey.delete(chatId);
        activeChats.delete(chatId);
        imageAnalysisState.delete(chatId);
        audioAnalysisState.delete(chatId);
        videoAnalysisState.delete(chatId);
        pdfAnalysisState.delete(chatId);
        awaitingApiKey.add(chatId);
        bot.sendMessage(chatId, "لطفاً کلید API خودت رو وارد کن:");
    });

    // Handle regular text messages based on active command
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const messageText = msg.text;

        if (!messageText || messageText.startsWith('/')) return;

        // Handle API key input after /setkey
        if (awaitingApiKey.has(chatId)) {
            awaitingApiKey.delete(chatId);
            const apiKey = messageText.trim();
            if (apiKey) {
                const isValid = await validateApiKey(apiKey);
                if (isValid) {
                    await addApiKey(userId, apiKey, chatId);
                    bot.sendMessage(chatId, `کلید API معتبره و تنظیم شد✅`);
                    bot.sendMessage(chatId, `
امکانات ربات🔱
🤖برای چت با هوش مصنوعی از دستور /startchat استفاده کن
🖼برای تحلیل تصویر از دستور /imageanalyze استفاده کن
🎙برای تحلیل صوت از دستور /audioanalyze استفاده کن
📕برای تحلیل پی دی اف از دستور /pdfanalyze استفاده کن
📺برای تحلیل ویدیو از دستور /videoanalyze استفاده کن
🔑با دستور /setkey کلید API خودت رو به‌روزرسانی کن
📚آموزش دریافت کلید API رایگان /help`)
                } else {
                    bot.sendMessage(chatId, "کلید API نامعتبره. لطفاً دوباره با دستور /setkey امتحان کن.");
                }
            } else {
                bot.sendMessage(chatId, "کلید وارد نشده. لطفاً دستور /setkey رو برای تنظیم مجدد استفاده کن.");
            }
            return;
        }
        // Handle text messages for image analysis
        if (imageAnalysisState.has(chatId)) {
            const state = imageAnalysisState.get(chatId);
            if (state.state === 'awaitingDescription') {
                const hashedUserId = hashData(userId.toString());
                try {
                    const row = await dbGet('SELECT api_key FROM users WHERE user_id = ?', [hashedUserId]);
                    if (!row) {
                        return bot.sendMessage(chatId, "ابتدا باید یک کلید API تنظیم کنی. از دستور /setkey استفاده کن.");
                    }

                    const decryptedApiKey = decrypt(row.api_key);
                    await bot.sendMessage(chatId, "🖼در حال تحلیل تصویر...");
                    await analyzeImage(state.fileLink, chatId, decryptedApiKey, messageText);

                    // Clear the analysis state after completion
                    imageAnalysisState.delete(chatId);
                } catch (err) {
                    handleError(err, chatId);
                }
                return; // Prevent further processing of this message
            }
        }
        // Handle text messages for audio analysis
        if (audioAnalysisState.has(chatId)) {
            const state = audioAnalysisState.get(chatId);
            if (state.state === 'awaitingDescription') {
                const hashedUserId = hashData(userId.toString());
                try {
                    const row = await dbGet('SELECT api_key FROM users WHERE user_id = ?', [hashedUserId]);
                    if (!row) {
                        return bot.sendMessage(chatId, "ابتدا باید یک کلید API تنظیم کنی. از دستور /setkey استفاده کن.");
                    }

                    const decryptedApiKey = decrypt(row.api_key);
                    await bot.sendMessage(chatId, "🎙در حال تحلیل فایل صوتی...");
                    await analyzeAudio(state.fileLink, chatId, decryptedApiKey, messageText);

                    // Clear the analysis state after completion
                    audioAnalysisState.delete(chatId);
                } catch (err) {
                    handleError(err, chatId);
                }
                return; // Prevent further processing of this message
            }
        }
        // Handle text messages for PDF analysis
        if (pdfAnalysisState.has(chatId)) {
            const state = pdfAnalysisState.get(chatId);
            if (state.state === 'awaitingDescription') {
                const hashedUserId = hashData(userId.toString());
                try {
                    const row = await dbGet('SELECT api_key FROM users WHERE user_id = ?', [hashedUserId]);
                    if (!row) {
                        return bot.sendMessage(chatId, "ابتدا باید یک کلید API تنظیم کنی. از دستور /setkey استفاده کن.");
                    }

                    const decryptedApiKey = decrypt(row.api_key);
                    await bot.sendMessage(chatId, "📕در حال تحلیل فایل پی دی اف...");
                    await analyzePdf(state.fileLink, chatId, decryptedApiKey, messageText);

                    // Clear the analysis state after completion
                    pdfAnalysisState.delete(chatId);
                } catch (err) {
                    handleError(err, chatId);
                }
                return; // Prevent further processing of this message
            }
        }
        // Handle text messages for video analysis
        if (videoAnalysisState.has(chatId)) {
            const state = videoAnalysisState.get(chatId);
            if (state.state === 'awaitingDescription') {
                const hashedUserId = hashData(userId.toString());
                try {
                    const row = await dbGet('SELECT api_key FROM users WHERE user_id = ?', [hashedUserId]);
                    if (!row) {
                        return bot.sendMessage(chatId, "ابتدا باید یک کلید API تنظیم کنی. از دستور /setkey استفاده کن.");
                    }

                    const decryptedApiKey = decrypt(row.api_key);
                    await bot.sendMessage(chatId, "📺در حال تحلیل ویدیو...(لطفا منتظر بمانید،تحلیل ویدیو کمی زمانبر میباشد)");
                    await analyzeVideo(state.fileLink, chatId, decryptedApiKey, messageText);

                    // Clear the analysis state after completion
                    videoAnalysisState.delete(chatId);
                } catch (err) {
                    handleError(err, chatId);
                }
                return; // Prevent further processing of this message
            }
        }
        // Handle text messages after /startchat
        if (activeChats.has(chatId)) {
            if (isRateLimited(userId)) {
                bot.sendMessage(chatId, "تعداد درخواست‌ها از حد مجاز گذشته. لطفاً بعداً دوباره امتحان کن.");
                return;
            }

            const hashedUserId = hashData(userId.toString());
            try {
                const row = await dbGet('SELECT api_key FROM users WHERE user_id = ?', [hashedUserId]);
                if (!row) {
                    bot.sendMessage(chatId, "ابتدا باید یک کلید API تنظیم کنی. از دستور /setkey استفاده کن.");
                } else {
                    const decryptedApiKey = decrypt(row.api_key);
                    bot.sendMessage(chatId, "🤖در حال تایپ کردن...");
                    await generateText(chatId, decryptedApiKey, messageText);
                }
            } catch (err) {
                handleError(err, chatId);
            }
            return;
        }

        // If no active context for message
        bot.sendMessage(chatId, `🤖برای چت با هوش مصنوعی از دستور /startchat استفاده کن
🖼برای تحلیل تصویر از دستور /imageanalyze استفاده کن
🎙برای تحلیل صوت از دستور /audioanalyze استفاده کن
📕برای تحلیل پی دی اف از دستور /pdfanalyze استفاده کن
📺برای تحلیل ویدیو از دستور /videoanalyze استفاده کن
🔑با دستور /setkey کلید API خودت رو تنظیم یا به‌روزرسانی کن.`);
    });

    // Handle /endchat command to end the conversation
    bot.onText(/\/endchat/, (msg) => {
        const chatId = msg.chat.id;
        if (activeChats.has(chatId)) {
            activeChats.delete(chatId);
            bot.sendMessage(chatId, "چت پایان یافت. برای شروع مجدد، از /startchat استفاده کنید.");
        } else {
            bot.sendMessage(chatId, "چتی فعال نیست.");
        }
    });
}


// Log activity to console with timestamps
function logActivity(activity) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${activity}`);
}

// Error handling helper
function handleError(error, chatId = null) {
    const errorMessage = `Error: ${error.message || error}`;
    logActivity(errorMessage);
    if (chatId) {
        bot.sendMessage(chatId, "یک خطا پیش آمد. لطفاً بعداً دوباره امتحان کن.");
    }
}
async function validateApiKey(apiKey) {
    const cacheKey = `apiKey_${apiKey}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-002" });
        const prompt = "Test prompt for validation purposes.";
        await model.generateContent(prompt);
        cache.set(cacheKey, true);
        return true;
    } catch (error) {
        console.error(`API key validation failed: ${error.message}`);
        cache.set(cacheKey, false);
        return false;
    }
}

async function addApiKey(userId, apiKey, chatId) {
    try {
        const hashedUserId = hashData(userId.toString());
        const encryptedApiKey = encrypt(apiKey); // Encrypt the API key

        const existingUser = await dbGet('SELECT * FROM users WHERE user_id = ?', [hashedUserId]);
        if (existingUser) {
            await dbRun('UPDATE users SET api_key = ? WHERE user_id = ?', [encryptedApiKey, hashedUserId]);
            logActivity(`User ${userId} updated their encrypted API key.`);
        } else {
            await dbRun('INSERT INTO users (user_id, api_key) VALUES (?, ?)', [hashedUserId, encryptedApiKey]);
            logActivity(`User ${userId} added an encrypted API key.`);
        }
    } catch (err) {
        handleError(err, chatId);
    }
}
// function to analyze image files
async function analyzeImage(fileLink, chatId, apiKey, userRequest) {
    let tempFilePath = '';
    try {
        // Download the image file from the provided link
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        tempFilePath = path.join(__dirname, `temp_image_${Date.now()}`);
        fs.writeFileSync(tempFilePath, buffer);  // Save the image locally

        // Identify MIME type of the image
        const mimeType = getMimeType(fileLink);
        logActivity(`Analyzing image with MIME type: ${mimeType}`);

        // Set up the file manager and generative AI
        const fileManager = new GoogleAIFileManager(apiKey);
        const genAI = new GoogleGenerativeAI(apiKey);

        // Upload the file to Google's AI services
        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
            mimeType: mimeType,
            displayName: 'temp_image',
        });

        // Set up safety settings to avoid generating unsafe content
        const safetySettings = [
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
        ];

        // Set up the generative model using the Gemini 1.5 flash model
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-002', safetySettings: safetySettings });

        // Generate the description based on the user request or a default prompt
        const result = await model.generateContent([
            {
                fileData: {
                    mimeType: uploadResponse.file.mimeType,
                    fileUri: uploadResponse.file.uri,
                },
            },
            { 
                text: userRequest || `این عکس رو با جزییات کامل توصیف کن، لحن گفتارت صمیمی و خودمونی و بالغ باشه` 
            },
        ]);

        // Get the generated description and send it back to the user
        const description = result.response.text();
        await offsetHandling(chatId, description);
        /*
        bot.sendMessage(chatId, `📚🎴✨\n${description}📚🎴✨`, {
            parse_mode: 'Markdown'
        });
        */

        logActivity(`Generated description sent to user ${chatId}`);

    } catch (error) {
        // Handle different error types
        if (error.message.includes('500 Internal Server Error')) {
            bot.sendMessage(chatId, "متأسفم، ولی یک مشکل موقتی با سرویس تحلیل تصویر پیش آمده. لطفاً یک یا دو دقیقه دیگر امتحان کن یا با تصویر دیگری تلاش کن.");
            logActivity(`Internal Server Error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('SAFETY')) {
            bot.sendMessage(chatId, "متأسفم، اما به خاطر مسائل ایمنی نمی‌توانم این تصویر را پردازش کنم. لطفاً مطمئن شو که تصاویری که ارسال می‌کنی مناسب و بدون محتوای حساس یا صریح باشند.");
            logActivity(`Safety error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('429 Too Many Requests') || error.message.includes('Resource has been exhausted')) {
            bot.sendMessage(chatId, "تعداد درخواست‌ها بیش از حد مجاز است. API تحت فشار است. لطفاً دقایقی بعد دوباره امتحان کن.");
            logActivity(`API quota exceeded for user ${chatId}: ${error.message}`);
        } else {
            handleError(error, chatId);
        }
    } finally {
        // Cleanup: remove the saved file after processing
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
    }
}
// function to analyze audio files
async function analyzeAudio(fileLink, chatId, apiKey, userRequest) {
    let tempFilePath = '';
    try {
        // Download the audio file from the provided link
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        tempFilePath = path.join(__dirname, `temp_audio_${Date.now()}`);
        fs.writeFileSync(tempFilePath, buffer);  // Save the audio locally

        // Identify MIME type of the image
        const mimeType = getMimeType(fileLink);
        logActivity(`Analyzing audio with MIME type: ${mimeType}`);

        // Set up the file manager and generative AI
        const fileManager = new GoogleAIFileManager(apiKey);
        const genAI = new GoogleGenerativeAI(apiKey);

        // Upload the file to Google's AI services
        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
            mimeType: mimeType,
            displayName: 'temp_audio',
        });

        // Set up safety settings to avoid generating unsafe content
        const safetySettings = [
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
        ];

        // Set up the generative model using the Gemini 1.5 flash model
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-002', safetySettings: safetySettings });

        // Generate the description based on the user request or a default prompt
        const result = await model.generateContent([
            {
                fileData: {
                    mimeType: uploadResponse.file.mimeType,
                    fileUri: uploadResponse.file.uri,
                },
            },
            { 
                text: userRequest || `این صدا رو با جزییات کامل توصیف کن، لحن گفتارت صمیمی و خودمونی و بالغ باشه`  
            },
        ]);

        // Get the generated description and send it back to the user
        const description = result.response.text();
        await offsetHandling(chatId, description);
        /*
        bot.sendMessage(chatId, `📚🎴✨\n${description}📚🎴✨`, {
            parse_mode: 'Markdown'
        });
        */

        logActivity(`Generated description sent to user ${chatId}`);

    } catch (error) {
        // Handle different error types
        if (error.message.includes('500 Internal Server Error')) {
            bot.sendMessage(chatId, "متأسفم، ولی یک مشکل موقتی با سرویس تحلیل تصویر پیش آمده. لطفاً یک یا دو دقیقه دیگر امتحان کن یا با تصویر دیگری تلاش کن.");
            logActivity(`Internal Server Error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('SAFETY')) {
            bot.sendMessage(chatId, "متأسفم، اما به خاطر مسائل ایمنی نمی‌توانم این تصویر را پردازش کنم. لطفاً مطمئن شو که تصاویری که ارسال می‌کنی مناسب و بدون محتوای حساس یا صریح باشند.");
            logActivity(`Safety error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('429 Too Many Requests') || error.message.includes('Resource has been exhausted')) {
            bot.sendMessage(chatId, "تعداد درخواست‌ها بیش از حد مجاز است. API تحت فشار است. لطفاً دقایقی بعد دوباره امتحان کن.");
            logActivity(`API quota exceeded for user ${chatId}: ${error.message}`);
        } else {
            handleError(error, chatId);
        }
    } finally {
        // Cleanup: remove the saved file after processing
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
    }
}
// function to analyze pdf files
async function analyzePdf(fileLink, chatId, apiKey, userRequest) {
    let tempFilePath = '';
    try {
        // Download the audio file from the provided link
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        tempFilePath = path.join(__dirname, `temp_Pdf_${Date.now()}`);
        fs.writeFileSync(tempFilePath, buffer);  // Save the audio locally

        // Identify MIME type of the image
        const mimeType = getMimeType(fileLink);
        logActivity(`Analyzing Pdf with MIME type: ${mimeType}`);

        // Set up the file manager and generative AI
        const fileManager = new GoogleAIFileManager(apiKey);
        const genAI = new GoogleGenerativeAI(apiKey);

        // Upload the file to Google's AI services
        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
            mimeType: mimeType,
            displayName: 'temp_Pdf',
        });

        // Set up safety settings to avoid generating unsafe content
        const safetySettings = [
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
        ];

        // Set up the generative model using the Gemini 1.5 flash model
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-002', safetySettings: safetySettings });

        // Generate the description based on the user request or a default prompt
        const result = await model.generateContent([
            {
                fileData: {
                    mimeType: uploadResponse.file.mimeType,
                    fileUri: uploadResponse.file.uri,
                },
            },
            { 
                text: userRequest || `این فایل رو با جزییات کامل توصیف کن، لحن گفتارت صمیمی و خودمونی و بالغ باشه`  
            },
        ]);
        // Get the generated description and send it back to the user
        const description = result.response.text();
        await offsetHandling(chatId, description);
        /*
        bot.sendMessage(chatId, `📚🎴✨\n${description}📚🎴✨`, {
            parse_mode: 'Markdown'
        });
        */
        logActivity(`Generated description sent to user ${chatId}`);

    } catch (error) {
        // Handle different error types
        if (error.message.includes('500 Internal Server Error')) {
            bot.sendMessage(chatId, "متأسفم، ولی یک مشکل موقتی با سرویس تحلیل تصویر پیش آمده. لطفاً یک یا دو دقیقه دیگر امتحان کن یا با تصویر دیگری تلاش کن.");
            logActivity(`Internal Server Error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('SAFETY')) {
            bot.sendMessage(chatId, "متأسفم، اما به خاطر مسائل ایمنی نمی‌توانم این تصویر را پردازش کنم. لطفاً مطمئن شو که تصاویری که ارسال می‌کنی مناسب و بدون محتوای حساس یا صریح باشند.");
            logActivity(`Safety error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('429 Too Many Requests') || error.message.includes('Resource has been exhausted')) {
            bot.sendMessage(chatId, "تعداد درخواست‌ها بیش از حد مجاز است. API تحت فشار است. لطفاً دقایقی بعد دوباره امتحان کن.");
            logActivity(`API quota exceeded for user ${chatId}: ${error.message}`);
        } else {
            handleError(error, chatId);
        }
    } finally {
        // Cleanup: remove the saved file after processing
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
    }
}
async function waitForFilesActive(files, apiKey) {
    console.log("Waiting for file processing...");
    
    // Initialize fileManager with the provided API key
    const fileManager = new GoogleAIFileManager(apiKey);
    
    for (const name of files.map((file) => file.name)) {
        let file = await fileManager.getFile(name);
        
        // Loop until the file state is no longer "PROCESSING"
        while (file.state === "PROCESSING") {
            process.stdout.write(".");
            await new Promise((resolve) => setTimeout(resolve, 10_000));
            file = await fileManager.getFile(name);
        }

        // Check if the file is not "ACTIVE"
        if (file.state !== "ACTIVE") {
            throw Error(`File ${file.name} failed to process`);
        }
    }
    console.log("...all files ready\n");
}

async function analyzeVideo(fileLink, chatId, apiKey, userRequest) {
    let tempFilePath = '';
    try {
        // Download the video file from the provided link
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        tempFilePath = path.join(__dirname, `temp_video_${Date.now()}`);
        fs.writeFileSync(tempFilePath, buffer);  // Save the video locally

        // Identify MIME type of the video
        const mimeType = getMimeType(fileLink);
        logActivity(`Analyzing video with MIME type: ${mimeType}`);

        // Set up the file manager and generative AI
        const fileManager = new GoogleAIFileManager(apiKey);
        const genAI = new GoogleGenerativeAI(apiKey);

        // Upload the file to Google's AI services
        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
            mimeType: mimeType,
            displayName: 'temp_video',
        });

        // Wait for files to become active
        await waitForFilesActive([uploadResponse.file], apiKey);

        // Set up safety settings to avoid generating unsafe content
        const safetySettings = [
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
        ];

        // Set up the generative model using the Gemini 1.5 flash model
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-002', safetySettings: safetySettings });

        // Generate the description based on the user request or a default prompt
        const result = await model.generateContent([
            {
                fileData: {
                    mimeType: uploadResponse.file.mimeType,
                    fileUri: uploadResponse.file.uri,
                },
            },
            { 
                text: userRequest || `این ویدیو رو با جزییات کامل توصیف کن، لحن گفتارت صمیمی و خودمونی و بالغ باشه`  
            },
        ]);
        // Get the generated description and send it back to the user
        const description = result.response.text();
        await offsetHandling(chatId, description);
        /*
        bot.sendMessage(chatId, `📚🎴✨\n${description}📚🎴✨`, {
            parse_mode: 'Markdown'
        });
        */
        logActivity(`Generated description sent to user ${chatId}`);

    } catch (error) {
        // Handle different error types
        if (error.message.includes('500 Internal Server Error')) {
            bot.sendMessage(chatId, "متأسفم، ولی یک مشکل موقتی با سرویس تحلیل ویدیو پیش آمده. لطفاً یک یا دو دقیقه دیگر امتحان کن یا با ویدیو دیگری تلاش کن.");
            logActivity(`Internal Server Error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('SAFETY')) {
            bot.sendMessage(chatId, "متأسفم، اما به خاطر مسائل ایمنی نمی‌توانم این ویدیو را پردازش کنم. لطفاً مطمئن شو که ویدیوهایی که ارسال می‌کنی مناسب و بدون محتوای حساس یا صریح باشند.");
            logActivity(`Safety error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('429 Too Many Requests') || error.message.includes('Resource has been exhausted')) {
            bot.sendMessage(chatId, "تعداد درخواست‌ها بیش از حد مجاز است. API تحت فشار است. لطفاً دقایقی بعد دوباره امتحان کن.");
            logActivity(`API quota exceeded for user ${chatId}: ${error.message}`);
        } else {
            handleError(error, chatId);
        }
    } finally {
        // Cleanup: remove the saved file after processing
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
    }
}

function getMimeType(fileLink) {
    const extension = path.extname(fileLink).toLowerCase();
    switch (extension) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.gif':
            return 'image/gif';
        case '.webp':
            return 'image/webp';
        case '.heic':
            return 'image/heic';
        case '.heif':
            return 'image/heif';       
        case '.wav':
            return 'audio/wav';
        case '.mp3':
            return 'audio/mp3';
        case '.aiff':
            return 'audio/aiff';
        case '.ogg':
            return 'audio/ogg';
        case '.flac':
            return 'audio/flac';
        case '.pdf':
            return 'application/pdf';   
        case '.mp4':
            return 'video/mp4';
        case '.webm':
            return 'video/webm';
        case '.avi':
            return 'video/avi';
        case '.mov':
            return 'video/quicktime';
        default:
            return 'application/octet-stream';
    }
}


// Use a Map to store conversation history for each user
const chatHistory = new Map();

async function generateText(chatId, apiKey, userInput) {
    try {
        // Initialize the Generative AI API with the given apiKey
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-002",
            systemInstruction: `اسم تو مغز مصنوعی هستش از کانال @FansyArtAi، تو یک دستیار هوش مصنوعی خلاق و باهوش هستی که درخواست مخاطب رو بخوبی انجام میدی، لحن حرف زدنت خودمونی و صمیمی و نزدیک به گفتار هستش و در عین حین حال سعی کن بچه گانه حرف نزنی چون مخاطبت بالغ هست پس سعی کن از کلمات پخته استفاده کنی و همچنین متن رو با ایموجی و ساختار زیبا، جذاب کن.`

        });

        const generationConfig = {
            temperature: 1,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
            responseMimeType: "text/plain"
        };
        const safetySettings = [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
          ];

        // Retrieve chat history for the current user
        let history = chatHistory.get(chatId) || [];

        // Add the user's latest message to the history
        history.push({
            role: "user",
            parts: [{ text: `سلام، شروع کن.` }]
        });

        // Create a new chat session with the updated history
        const chatSession = model.startChat({
            generationConfig,
            safetySettings,
            history
        });

        // Send the user's message to the model and get the response
        const result = await chatSession.sendMessage(userInput);
        const generatedText = result.response.text();

        // Add the model's response to the history
        history.push({
            role: "model",
            parts: [{ text: generatedText }]
        });

        // Update the chat history for the user
        chatHistory.set(chatId, history);
        //bot.sendMessage(chatId, generatedText, { parse_mode: 'Markdown' });
        // Send the generated text back to the user with error handling
        //await sendMessageWithRetry(chatId, generatedText);
        // Send the generated text back to the user with error handling
        /*
        try {
            await bot.sendMessage(chatId, generatedText, { parse_mode: 'MarkdownV2' });
        } catch (error) {
            console.error('Error sending message, retrying...', error);
            await sendMessageWithRetry(chatId, generatedText);
        }
        */
        await offsetHandling(chatId, generatedText);
        logActivity(`Generated text sent to user ${chatId}`);
    } catch (error) {
        if (error.message.includes('500 Internal Server Error')) {
            bot.sendMessage(chatId, "متأسفم، ولی یک مشکل موقتی با سرویس پیش آمده. لطفاً یک یا دو دقیقه دیگر امتحان کن یا با تصویر دیگری تلاش کن.");
            logActivity(`Internal Server Error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('SAFETY')) {
            bot.sendMessage(chatId, "متأسفم، اما به خاطر مسائل ایمنی نمی‌توانم این متن را پردازش کنم. لطفاً مطمئن شو که متنی که ارسال می‌کنی مناسب و بدون محتوای حساس یا صریح باشند.");
            logActivity(`Safety error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('OTHER')) {
            bot.sendMessage(chatId, "متأسفم، اما به خاطر مسائل ایمنی نمی‌توانم این متن را پردازش کنم. لطفاً مطمئن شو که متنی که ارسال می‌کنی مناسب و بدون محتوای حساس یا صریح باشند.");
            logActivity(`Safety error encountered for user ${chatId}: ${error.message}`);
        } else if (error.message.includes('429 Too Many Requests') || error.message.includes('Resource has been exhausted')) {
            bot.sendMessage(chatId, "تعداد درخواست‌ها بیش از حد مجاز است. API تحت فشار است. لطفاً دقایقی بعد دوباره امتحان کن.");
            logActivity(`API quota exceeded for user ${chatId}: ${error.message}`);
        } else (handleError(error, chatId));
    }
}
async function offsetHandling(chatId, text) {
    try {
        await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
    } catch (error) {
        console.error('Error sending message, retrying...', error);
        await sendMessageWithRetry(chatId, text);
    }
    
}
function escapeMarkdown(text) {
    const specialChars = '_*[]()~`>#+-=|{}.!';
    return text.replace(new RegExp(`[${specialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`, 'g'), '\\$&');
}

function sanitizeText(text) {
    let escaped = escapeMarkdown(text);
    // Replace newlines with actual newline character for proper display
    escaped = escaped.replace(/\\n/g, '\n');
    return escaped;
}

function logSanitizedText(text) {
    console.log("Sanitized text (escaped for console):", 
                text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n'));
}

async function sendMessageWithRetry(chatId, text, maxRetries = 3) {
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            // Sanitize text before each attempt
            let sanitizedText = sanitizeText(text);
            logSanitizedText(sanitizedText);
            
            // Try sending the message with Markdown
            await bot.sendMessage(chatId, sanitizedText, { parse_mode: 'MarkdownV2' });
            console.log("Message sent successfully with MarkdownV2");
            return; // Message sent successfully, exit function
        } catch (error) {
            attempt++;
            
            console.error(`Attempt ${attempt} failed:`, error.message);
            
            if (error.response?.description?.includes("can't parse entities")) {
                console.log(`Entity parsing error encountered. Retrying with sanitized text.`);
                // If it's the last attempt, fall through to send without formatting
                if (attempt === maxRetries) {
                    console.log("Max retries reached. Falling back to plain text.");
                    break;
                }
            } else {
                // For any other error, throw and let the caller handle it
                throw error;
            }
        }
    }
    // If all retry attempts failed, send the message without Markdown formatting
    try {
        await bot.sendMessage(chatId, text, { parse_mode: 'None' });
        console.log("Message sent successfully without formatting");
    } catch (error) {
        console.error("Failed to send even without formatting:", error.message);
        throw error;
    }
}
// Start the bot initially
startBot();