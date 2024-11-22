@echo off

:: Ask for Bot Token
set /p TELEGRAM_BOT_TOKEN=Enter your Bot Token: 

:: Ask for Admin User ID
set /p ADMIN_USER_ID=Enter the Admin User ID (Telegram): 

:: Generate 64-character (32-byte) random ENCRYPTION_KEY
for /f "tokens=*" %%a in ('powershell -Command "[System.Guid]::NewGuid().ToString('N') + [System.Guid]::NewGuid().ToString('N')"') do set ENCRYPTION_KEY=%%a

:: Generate 32-character (16-byte) random ENCRYPTION_IV
for /f "tokens=*" %%b in ('powershell -Command "[System.Guid]::NewGuid().ToString('N')"') do set ENCRYPTION_IV=%%b

:: Write to .env file
(
echo TELEGRAM_BOT_TOKEN=%TELEGRAM_BOT_TOKEN%
echo ADMIN_USER_ID=%ADMIN_USER_ID%
echo ENCRYPTION_KEY=%ENCRYPTION_KEY%
echo ENCRYPTION_IV=%ENCRYPTION_IV%
) > .env

:: Write note to console
echo .env file generated with the following values:
type .env
echo -------------------------------------------------
echo NOTE: To add additional admin IDs, edit the config.js file.
pause