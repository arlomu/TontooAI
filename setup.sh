#!/bin/bash

sudo apt install openssl
cd sll
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
cd ..
sudo apt install systemd
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma3:1b
sudo apt install nodejs
sudo apt install npm
sudo node app.js