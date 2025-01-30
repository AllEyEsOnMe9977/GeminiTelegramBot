# Gemini Telegram Bot 🚀

This repository contains the code for the **Gemini Telegram Bot** (written in **Node.js**), which allows users to interact with the **Gemini API** and analyze various file types, such as **images, audio, PDFs, and videos** directly through Telegram.  

Follow the steps below to **install, configure, and run** the bot on your machine.

---

## 📌 Prerequisites

- **[Node.js & npm](https://nodejs.org/en/download/package-manager)**
- **[Git](https://git-scm.com/downloads)**
- (For Linux) **Ensure pm2 is installed globally**  
  _(Don't worry, our script installs it automatically if it's missing!)_

---

## 🔧 Setup Instructions

### 1️⃣ Clone the repository  
```bash
git clone https://github.com/AllEyEsOnMe9977/GeminiTelegramBot.git
```

### 2️⃣ Navigate to the project directory  
```bash
cd GeminiTelegramBot
```

### 3️⃣ Run the setup script

#### 👉 **For Linux/macOS:**
```bash
chmod +x setup.sh && sudo ./setup.sh
```

#### 👉 **For Windows (Run as Administrator):**
```cmd
setup.bat
```

- This script:
  - Initializes the **npm project**
  - Installs all required dependencies, including `pm2`
  - Asks for **Bot Token** & **Admin User ID**
  - Generates the `.env` file automatically
  - Starts the bot with **pm2** and configures it to run on system startup

---

## 🔑 Configuration

During setup, you will be asked to **enter API keys** for proper bot operation:

- ✔️ **Get a Gemini API key** from:
  - [Google Gemini API Key](https://aistudio.google.com/app/apikey)
- ✔️ **Get your Telegram bot token** from:
  - [@BotFather on Telegram](https://t.me/BotFather)
- ✔️ **Get your Telegram User ID** from:
  - [@JsonDumpBot on Telegram](https://t.me/JsonDumpBot)

---

## 🤖 Setting Up Bot Commands in BotFather

To configure bot commands:

1. Open **[@BotFather](https://t.me/BotFather)** in Telegram.
2. Send `/mybots` and select your bot.
3. Go to **Bot Settings** → **/setcommands**.
4. Copy and paste the following command list:

   ```
   start - 🚀 Initiate the bot
   endchat - ❌ End the current chat
   startchat - 💬 Start a new chat
   imageanalyze - 🖼️ Analyze an image
   audioanalyze - 🎧 Analyze an audio file
   pdfanalyze - 📄 Analyze a PDF file
   videoanalyze - 🎥 Analyze a video file
   setkey - 🔑 Set a Gemini API key
   help - 📚 Tutorial
   ```

5. Save the changes, and now your bot will show these commands when users type `/`.

---

## 🚀 Running & Managing the Bot with pm2

### ✅ Check if the bot is running:
```bash
pm2 status
```

### 🔍 View bot logs:
```bash
pm2 logs gemini-bot
```

### ⏹️ Stop the bot:
```bash
pm2 stop gemini-bot
```

### 🔄 Restart the bot:
```bash
pm2 restart gemini-bot
```

### ♻️ Make sure the bot runs on startup:
```bash
pm2 startup
pm2 save
```

---

## 🎯 Bot Features

- 🖼️ **Image Analysis** (Extract insights from images)
- 🎧 **Audio Analysis** (Process and transcribe audio files)
- 📄 **PDF Analysis** (Summarize or extract text from PDFs)
- 🎥 **Video Analysis** (Analyze video content)
- 🤖 **AI-powered Conversations** (Powered by Google Gemini AI)
- 🔒 **Secure & Encrypted** (Uses strong encryption for API keys)

---

## 🌐 Language Support

**The bot operates in Persian**, but it can also **respond in English** for AI-based conversations and analysis requests.

---

## 🎉 Enjoy using the Gemini Telegram Bot!  

If you find this project useful, consider **starring ⭐ the repository** to support development!
