@echo off
setlocal enabledelayedexpansion

:: Colorful output definitions
set "GREEN=[92m"
set "RED=[91m"
set "BLUE=[96m"
set "RESET=[0m"

echo.
echo =======================================================
echo          YouTube Shorts Blocker - Native Host Setup
echo =======================================================
echo.

:: Get the directory where the batch file is located
set "DIR=%~dp0"
:: Remove trailing backslash
set "DIR=%DIR:~0,-1%"

:: Check and download yt-dlp.exe if it doesn't exist
if not exist "%DIR%\yt-dlp.exe" (
    echo [96mDownloading latest yt-dlp.exe...[0m
    curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -o "%DIR%\yt-dlp.exe"
    if !errorlevel! equ 0 (
        echo  [92mSuccessfully downloaded yt-dlp.exe [0m
    ) else (
        echo  [91mError downloading yt-dlp.exe! Please download it manually and place it in this folder. [0m
        pause
        exit /b
    )
    echo.
)

:: Define the manifest file
set "MANIFEST=%DIR%\com.paracci.youtubedownloader.json"

:: Define the registry key for Chrome
set "REG_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.paracci.youtubedownloader"

echo Please enter the Extension ID shown on your setup page.
echo (It looks something like: ceobjkadnolkbfifpjppdfccnjpjlpbe)
set /p EXTENSION_ID="Extension ID: "

if "!EXTENSION_ID!"=="" (
    echo.
    echo [91mError: Extension ID cannot be blank.[0m
    pause
    exit /b
)

echo.
echo Generating Native Host Manifest for Extension ID: !EXTENSION_ID! ...

:: Use Node.js to reliably create the JSON file to avoid bat echo escaping issues
node -e "const fs = require('fs'); const manifest = { name: 'com.paracci.youtubedownloader', description: 'YouTube Shorts Blocker - Native Download Host', path: '%DIR:\=\\%\\\\native-host.bat', type: 'stdio', allowed_origins: ['chrome-extension://!EXTENSION_ID!/'] }; fs.writeFileSync('%MANIFEST:\=/%', JSON.stringify(manifest, null, 2));"

if %errorlevel% neq 0 (
    echo.
    echo [91mError: Node.js is required but could not be run. Please install Node.js from https://nodejs.org/[0m
    pause
    exit /b
)

echo @echo off > "%DIR%\native-host.bat"
echo node "%DIR%\native-host.js" %%* >> "%DIR%\native-host.bat"

echo.
echo Adding Chrome Registry Key...
reg add "%REG_KEY%" /ve /t REG_SZ /d "%MANIFEST%" /f

if %errorlevel% equ 0 (
    echo.
    echo [92mSUCCESS: Native Messaging Host installed correctly.[0m
    echo You may now return to Chrome and click "Check Again".
) else (
    echo.
    echo [91mFAILED: Could not write Registry Key. You might need to Run as Administrator.[0m
)

echo.
pause
