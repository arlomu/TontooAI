#!/bin/sh
set -e

GITHUB_REPO="arlomu/TontooAI"

FILES="deepsearch.tar chat.tar websearch.tar codeinterpreter.tar"

if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq ist nicht installiert. Bitte zuerst installieren (sudo apt install jq)."
    exit 1
fi

for FILE_NAME in $FILES; do
    echo "Processing $FILE_NAME ..."
    
    # Download-URL aus GitHub Release JSON extrahieren
    DOWNLOAD_URL=$(curl -s "https://api.github.com/repos/$GITHUB_REPO/releases/latest" \
      | jq -r ".assets[] | select(.name==\"$FILE_NAME\") | .browser_download_url")

    # Prüfen, ob URL gefunden wurde
    if [ -z "$DOWNLOAD_URL" ]; then
        echo "Error: Download URL for $FILE_NAME not found!"
        echo "Available assets:"
        curl -s "https://api.github.com/repos/$GITHUB_REPO/releases/latest" | jq -r '.assets[].name'
        exit 1
    fi

    echo "Downloading $FILE_NAME from $DOWNLOAD_URL ..."
    curl -L -o "$FILE_NAME" "$DOWNLOAD_URL"

    echo "Loading Docker image from $FILE_NAME ..."
    docker load -i "$FILE_NAME"
done

IMAGE_NAME=$(docker images --format "{{.Repository}}:{{.Tag}}" | head -n 1)
echo "Starting container $IMAGE_NAME ..."
docker run --rm -it "$IMAGE_NAME"


docker network create tontooai-net

docker run -d \
  --name tontooai-chat-container \
  --network tontooai-net \
  --add-host=host.docker.internal:host-gateway \
  -p 8080:8080 \
  -p 443:443 \
  -p 80:80 \
  tontooai-chat

docker run -d \
  --name tontooai-websearch-container \
  --network tontooai-net \
  --add-host=host.docker.internal:host-gateway \
  tontooai-websearch

docker run -d \
  --name tontooai-codeinterpreter-container \
  --network tontooai-net \
  --add-host=host.docker.internal:host-gateway \
  tontooai-codeinterpreter

docker run -d \
  --name tontooai-deepsearch-container \
  --network tontooai-net \
  --add-host=host.docker.internal:host-gateway \
  tontooai-deepsearch

rm codeinterpreter.tar
rm chat.tar
rm deepsearch.tar
rm websearch.tar

echo "Done!"
