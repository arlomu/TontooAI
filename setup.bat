@echo off
setlocal enabledelayedexpansion

:: ===== Welcome message =====
echo Please make sure Node.js, npm, OpenSSL, and Ollama are installed and available in your PATH.
echo.

:: Log file
set LOG_FILE=%TEMP%\setup.log
set STEP=0
set TOTAL=2

:progress
set /a STEP+=1
set /a PERCENT=(STEP*100)/TOTAL

set BAR=
for /L %%i in (1,1,!PERCENT!/5) do set BAR=!BAR!#
set /a SPACES=20 - !PERCENT!/5
set SPACESTR=
for /L %%i in (1,1,!SPACES!) do set SPACESTR=!SPACESTR! 

<nul set /p =![BAR!!SPACESTR!] !PERCENT!%% - %1
echo.
goto :eof

:: Step 1: Install Node.js dependencies in Chat
cd Chat
call :progress "Installing Node.js dependencies in Chat..."
npm install >>"%LOG_FILE%" 2>&1
cd ..

:: Step 2: Install Node.js dependencies in Web-search
cd Web-search
call :progress "Installing Node.js dependencies in Web-search..."
npm install >>"%LOG_FILE%" 2>&1
cd ..

:: Finish
call :progress "Setup complete!"
echo.
echo All done! Logs are saved at %LOG_FILE%
pause
