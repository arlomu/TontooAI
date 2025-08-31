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
mkdir -p ssl
cd ssl
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
cd ..
progress "Ensuring systemd is installed..."
sudo apt install -y systemd >>"$LOG_FILE" 2>&1
progress "Installing Ollama..."
curl -fsSL https://ollama.com/install.sh | sh >>"$LOG_FILE" 2>&1
progress "Pulling Gemma3 model..."
ollama pull gemma3:1b >>"$LOG_FILE" 2>&1
progress "Installing Node.js and npm..."
sudo apt install -y nodejs npm >>"$LOG_FILE" 2>&1
progress "Installing Python3 and dependencies..."
sudo apt install -y python3 python3-venv python3-pip >>"$LOG_FILE" 2>&1
python3 -m venv openinterpreter-env >>"$LOG_FILE" 2>&1
source openinterpreter-env/bin/activate
pip install open-interpreter >>"$LOG_FILE" 2>&1
progress "Starting Node.js app..."
sudo node app.js >>"$LOG_FILE" 2>&1 &
progress "Creating systemd service..."
SERVICE_FILE="/etc/systemd/system/my-node-app.service"
sudo bash -c "cat > $SERVICE_FILE" <<EOL
[Unit]
Description=My Node.js App
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/your/app.js
WorkingDirectory=/path/to/your
Restart=always
User=$USER
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOL
progress "Enabling service on boot..."
sudo systemctl daemon-reload >>"$LOG_FILE" 2>&1
sudo systemctl enable my-node-app.service >>"$LOG_FILE" 2>&1
sudo systemctl start my-node-app.service >>"$LOG_FILE" 2>&1
progress "Setup complete!"
echo -e "\nAll done! Logs at $LOG_FILE"
