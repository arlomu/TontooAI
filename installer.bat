@echo off
setlocal enabledelayedexpansion

REM --- Konfiguration ---
set GITHUB_REPO=arlomu/Tontoo
set FILE_NAME=TontooAI.tar

echo Fetching the latest release URL from GitHub...

REM --- GitHub API abfragen und Download-URL extrahieren ---
for /f "tokens=*" %%A in ('curl -s https://api.github.com/repos/%GITHUB_REPO%/releases/latest ^| findstr /r /c:"browser_download_url.*%FILE_NAME%"') do (
    set "LINE=%%A"
    for /f "tokens=2 delims=:" %%B in ("!LINE!") do set URL_PART=%%B
    set "DOWNLOAD_URL=!URL_PART:~2,-1!"
)

if "%DOWNLOAD_URL%"=="" (
    echo Error: Download URL not found!
    exit /b 1
)

echo Download URL found: %DOWNLOAD_URL%
echo Downloading %FILE_NAME%...

curl -L -o %FILE_NAME% %DOWNLOAD_URL%

if not exist %FILE_NAME% (
    echo Error: Download failed!
    exit /b 1
)

echo Loading Docker image from %FILE_NAME%...
docker load -i %FILE_NAME%

REM --- Erstes Docker-Image abrufen ---
for /f "tokens=1,2" %%I in ('docker images --format "%%Repository%%:%%Tag%%"') do (
    set IMAGE_NAME=%%I
    goto :RUN_CONTAINER
)

:RUN_CONTAINER
if "%IMAGE_NAME%"=="" (
    echo Error: No Docker image found!
    exit /b 1
)

echo Using image: %IMAGE_NAME%
echo Starting container...
docker run --rm -it %IMAGE_NAME%

echo Done!
pause
