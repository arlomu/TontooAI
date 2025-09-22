#!/bin/bash
set -e
GITHUB_REPO="arlomu/Tontoo"
FILE_NAME="TontooAI.tar"
echo "Fetching the latest release URL from GitHub..."
DOWNLOAD_URL=$(curl -s "https://api.github.com/repos/$GITHUB_REPO/releases/latest" \
  | grep "browser_download_url.*$FILE_NAME" \
  | cut -d '"' -f 4)
if [ -z "$DOWNLOAD_URL" ]; then
  echo "Error: Download URL not found!"
  exit 1
fi
echo "Download URL found: $DOWNLOAD_URL"
echo "Downloading $FILE_NAME..."
curl -L -o $FILE_NAME $DOWNLOAD_URL
echo "Loading Docker image from $FILE_NAME..."
docker load -i $FILE_NAME
IMAGE_NAME=$(docker images --format "{{.Repository}}:{{.Tag}}" | head -n 1)
echo "Using image: $IMAGE_NAME"
echo "Starting container..."
docker run --rm -it $IMAGE_NAME
echo "Done!"
