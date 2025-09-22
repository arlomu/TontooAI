#!/bin/sh
set -e

# Repo anpassen
GITHUB_REPO="arlomu/TontooAI"

# Liste der Docker-Tar-Dateien
FILES="deepsearch.tar chat.tar websearch.tar codeinterpreter.tar"

# Prüfen, ob jq installiert ist
if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq ist nicht installiert. Bitte zuerst installieren (sudo apt install jq)."
    exit 1
fi

# Alle Dateien herunterladen und Docker-Images laden
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

# Erstes Image aus Docker-Images auswählen
IMAGE_NAME=$(docker images --format "{{.Repository}}:{{.Tag}}" | head -n 1)
echo "Starting container $IMAGE_NAME ..."
docker run --rm -it "$IMAGE_NAME"

# Heruntergeladene Dateien löschen
for FILE_NAME in $FILES; do
    rm -f "$FILE_NAME"
done

echo "Done!"
