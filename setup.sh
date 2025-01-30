#!/bin/bash

######################################
# Step 0: Move into Script Directory
######################################
# This ensures we operate in the same folder as Bot.js
cd "$(dirname "$0")"

######################################
# Step 1: NPM Initialization & Install
######################################
echo "Step 1: Initializing npm and installing required packages..."
npm init -y

npm install dotenv node-telegram-bot-api sqlite3 axios node-cache util crypto \
  @google/generative-ai

# Install pm2 globally (so we can manage processes)
npm install -g pm2

# Pause to review
read -p "Press Enter to continue to Step 2..."

###########################################
# Step 2: Prompt User & Create .env File
###########################################
echo "Step 2: Gathering Bot config and creating .env..."

# Prompt for Bot Token
read -p "Enter your Bot Token: " TELEGRAM_BOT_TOKEN

# Prompt for Admin User ID
read -p "Enter the Admin User ID (Telegram): " ADMIN_USER_ID

# Generate 64-character (32-byte) random ENCRYPTION_KEY
ENCRYPTION_KEY=$(cat /proc/sys/kernel/random/uuid | tr -d '-' && cat /proc/sys/kernel/random/uuid | tr -d '-')

# Generate 32-character (16-byte) random ENCRYPTION_IV
ENCRYPTION_IV=$(cat /proc/sys/kernel/random/uuid | tr -d '-' | cut -c1-32)

# Write to .env file
cat <<EOF > .env
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
ADMIN_USER_ID=$ADMIN_USER_ID
ENCRYPTION_KEY=$ENCRYPTION_KEY
ENCRYPTION_IV=$ENCRYPTION_IV
EOF

echo ".env file generated with the following values:"
cat .env
echo "-------------------------------------------------"
echo "NOTE: To add additional admin IDs, edit the config.js file."

# Pause to review
read -p "Press Enter to continue to Step 3..."

########################################
# Step 3: Configure & Start PM2 on Boot
########################################
echo "Step 3: Configuring pm2 to run Bot.js"

# Start the bot with pm2
pm2 start Bot.js --name gemini-bot

# Generate startup script for systemd (so pm2 restarts on reboot)
# Here we assume 'root' user and /root home path. Adjust if needed.
pm2 startup systemd -u root --hp /root

# Save the current process list so pm2 restarts it on reboot
pm2 save

echo "All steps completed!"
echo "-------------------------------------------------"
echo "You can manage the process via pm2 commands:"
echo "  pm2 status"
echo "  pm2 logs gemini-bot"
echo "  pm2 restart gemini-bot"
echo "  pm2 stop gemini-bot"
echo
echo "Reboot to test if pm2 auto-starts gemini-bot."
echo "Done!"
