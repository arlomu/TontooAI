#!/bin/sh
set -e

GITHUB_REPO="arlomu/Tontoo"
FILES="deepsearch.tar chat.tar websearch.tar codeinterpreter.tar"

for FILE_NAME in $FILES; do
    echo "Processing $FILE_NAME ..."
    DOWNLOAD_URL=$(curl -s "https://api.github.com/repos/$GITHUB_REPO/releases/latest" \
      | grep "browser_download_url.*$FILE_NAME" \
      | cut -d '"' -f 4)
    
    if [ -z "$DOWNLOAD_URL" ]; then
        echo "Error: Download URL for $FILE_NAME not found!"
        exit 1
    fi

    echo "Downloading $FILE_NAME ..."
    curl -L -o "$FILE_NAME" "$DOWNLOAD_URL"
    echo "Loading Docker image from $FILE_NAME ..."
    docker load -i "$FILE_NAME"
done

IMAGE_NAME=$(docker images --format "{{.Repository}}:{{.Tag}}" | head -n 1)
echo "Starting container $IMAGE_NAME ..."
docker run --rm -it "$IMAGE_NAME"

# Dateien löschen
for FILE_NAME in $FILES; do
    rm -f "$FILE_NAME"
done

echo "Done!"
