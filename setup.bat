@echo off
REM ---------------------------------------------
REM Step 0: Move into Script Directory
REM ---------------------------------------------
cd /d "%~dp0"

echo Step 1: Initializing npm and installing required packages...
npm init -y

echo Installing project dependencies...
npm install dotenv node-telegram-bot-api sqlite3 axios node-cache util crypto ^
  @google/generative-ai

echo Installing pm2 globally...
npm install pm2 -g

pause

REM ---------------------------------------------
REM Step 2: Prompt User & Create .env File
REM ---------------------------------------------
echo Step 2: Gathering Bot config and creating .env...

set /p TELEGRAM_BOT_TOKEN=Enter your Bot Token:
set /p ADMIN_USER_ID=Enter the Admin User ID (Telegram):

REM Generate 64-character (32-byte) random ENCRYPTION_KEY (concatenate two GUIDs)
for /f "usebackq tokens=*" %%A in (`powershell -Command "[System.Guid]::NewGuid().ToString('N') + [System.Guid]::NewGuid().ToString('N')"`) do set ENCRYPTION_KEY=%%A

REM Generate 32-character (16-byte) random ENCRYPTION_IV (use one GUID, first 32 chars)
for /f "usebackq tokens=*" %%B in (`powershell -Command "[System.Guid]::NewGuid().ToString('N')"`) do (
  set ENCRYPTION_IV=%%B
)
set ENCRYPTION_IV=%ENCRYPTION_IV:~0,32%

REM Write to .env
(
  echo TELEGRAM_BOT_TOKEN=%TELEGRAM_BOT_TOKEN%
  echo ADMIN_USER_ID=%ADMIN_USER_ID%
  echo ENCRYPTION_KEY=%ENCRYPTION_KEY%
  echo ENCRYPTION_IV=%ENCRYPTION_IV%
) > .env

echo .env file generated with the following values:
type .env
echo -------------------------------------------------
echo NOTE: To add additional admin IDs, edit the config.js file.

pause

REM ---------------------------------------------
REM Step 3: Configure & Start PM2 on Boot
REM ---------------------------------------------
echo Step 3: Configuring pm2 to run Bot.js...

REM Start the bot with pm2 (assuming Bot.js is in the same directory)
pm2 start Bot.js --name gemini-bot

REM Generate pm2 startup script for Windows
pm2 startup windows

REM Save current process list so pm2 restarts on reboot
pm2 save

echo All steps completed!
echo -------------------------------------------------
echo You can manage the process via pm2 commands:
echo   pm2 status
echo   pm2 logs gemini-bot
echo   pm2 restart gemini-bot
echo   pm2 stop gemini-bot
echo.
echo Reboot to test if pm2 auto-starts gemini-bot.

pause
