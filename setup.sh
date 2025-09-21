#!/bin/bash

LOG_FILE="/tmp/setup.log"
STEP=0
TOTAL=11

function progress {
    STEP=$((STEP+1))
    PERCENT=$((STEP*100/TOTAL))
    BAR=$(printf "%0.s#" $(seq 1 $((PERCENT/5))))
    SPACES=$(printf "%0.s " $(seq 1 $((20-${#BAR}))))
    echo -ne "\r[$BAR$SPACES] $PERCENT% - $1"
}

progress "Updating..."
sudo apt update -y >>"$LOG_FILE" 2>&1
progress "Installing OpenSSL..."
sudo apt install -y openssl >>"$LOG_FILE" 2>&1
progress "Generating SSL certificate..."
cd Chat
cd ssl
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
cd ..
cd ..
progress "Installing Ollama..."
curl -fsSL https://ollama.com/install.sh | sh >>"$LOG_FILE" 2>&1
progress "Pulling Gemma3 1B model..."
ollama pull gemma3:1b >>"$LOG_FILE" 2>&1
progress "Installing Node.js and npm..."
sudo apt install -y nodejs npm >>"$LOG_FILE" 2>&1

cd Chat
progress "Installing Node.js dependencies..."
npm install >>"$LOG_FILE" 2>&1
cd ..

cd Web-search
progress "Installing Node.js dependencies..."
npm install >>"$LOG_FILE" 2>&1
cd ..

cd Deep-search
progress "Installing Node.js dependencies..."
npm install >>"$LOG_FILE" 2>&1
cd ..

cd Code-interpreter
progress "Installing Node.js dependencies..."
npm install >>"$LOG_FILE" 2>&1
cd ..

progress "Setup complete!"
echo -e "\nAll done! Logs at $LOG_FILE"
