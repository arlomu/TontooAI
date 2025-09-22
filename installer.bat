@echo off
setlocal enabledelayedexpansion

:: GitHub Repo und Dateien
set "GITHUB_REPO=arlomu/Tontoo"
set "FILES=deepsearch.tar chat.tar websearch.tar codeinterpreter.tar"

echo Fetching the latest release URLs from GitHub...

:: Schleife über alle Dateien
for %%F in (%FILES%) do (
    echo Processing %%F ...

    :: Download URL ermitteln
    for /f "tokens=*" %%U in ('curl -s https://api.github.com/repos/%GITHUB_REPO%/releases/latest ^| findstr /i "browser_download_url.*%%F"') do (
        set "LINE=%%U"
        for /f "tokens=4 delims=\"" %%A in ("!LINE!") do set "DOWNLOAD_URL=%%A"
    )

    if "!DOWNLOAD_URL!"=="" (
        echo Error: Download URL for %%F not found!
        exit /b 1
    )

    echo Download URL found: !DOWNLOAD_URL!
    echo Downloading %%F ...
    curl -L -o "%%F" "!DOWNLOAD_URL!"

    echo Loading Docker image from %%F ...
    docker load -i "%%F"
)

:: Letztes geladenes Image starten
for /f "tokens=1" %%I in ('docker images --format "{{.Repository}}:{{.Tag}}" ^| head -n 1') do set "IMAGE_NAME=%%I"
echo Using image: %IMAGE_NAME%
echo Starting container ...
docker run --rm -it %IMAGE_NAME%

:: Aufräumen
echo Cleaning up downloaded files ...
for %%F in (%FILES%) do (
    del /f /q "%%F"
)

echo Done!
pause
