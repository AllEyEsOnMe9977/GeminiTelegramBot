# Gemini Telegram Bot

This repository contains the code for the Gemini Telegram Bot (written in nodejs), which allows users to interact with the Gemini API and analyze various file types, such as images, audio, PDF, and video. Follow the instructions below to set up and configure the bot.

[💎 make sure to have npm installed on your machine](https://nodejs.org/en/download/package-manager)

## Setup Instructions

1. **Clone the repository:**
    ```bash
    git clone https://github.com/AllEyEsOnMe9977/GeminiTelegramBot.git
    ```

2. **Navigate to the project directory:**
    ```bash
    cd GeminiTelegramBot
    ```

3. **Set up the workspace:**
    ```bash
    createWorkSpace.bat
    ```

4. **Install the required dependencies:**
    ```bash
    installDeps.bat
    ```

5. **Configure the bot (e.g., API keys, tokens):**
    ```bash
    config.bat
    ```
    - ✔️ For the Gemini API key, visit the link below:
      - [Gemini API link](https://aistudio.google.com/app/apikey)
    - ✔️ For the Telegram bot token, use the [@BotFather on Telegram](https://t.me/BotFather).
    - ✔️ For your own Telegram user ID, use the [@JsonDumpBot on Telegram](https://t.me/JsonDumpBot).

6. **Set up Bot Commands in BotFather:**

    To set up custom commands for your bot, follow these steps:

    - Open **[BotFather](https://t.me/BotFather)** in Telegram.
    - Start a chat with BotFather and use the command `/mybots` to select your bot.
    - Choose your bot and go to **Bot Settings**.
    - Tap on **/setcommands** to configure your bot’s command list.
    - Add the following commands with emojis (copy and paste this list):
    
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

    - After adding these commands, your bot will show a custom command list to users when they type `/` in the chat.
   
7. **Launch the bot:**
    ```bash
    launch.bat
    ```

---

With these steps, your Gemini Telegram Bot should be fully set up and ready to interact with users. Enjoy analyzing images, audio, PDFs, and videos through Telegram!

**P.S:**

**The bot operates in Persian, but it is capable of responding in English for analysis requests or AI-based conversations**
