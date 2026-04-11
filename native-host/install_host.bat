@echo off
setlocal enabledelayedexpansion

:: __ Self-wrap: pencere her durumda acik kalsin ______________________________
if not "%_WRAPPED%"=="1" (
    set "_WRAPPED=1"
    cmd /k ""%~f0""
    exit /b
)

:: __ ANSI'yi MEVCUT oturumda anlik etkinlestir (SetConsoleMode API) __________
powershell -nop -c "Add-Type -Name W -MemberDefinition '[DllImport(\"kernel32.dll\")]public static extern bool SetConsoleMode(IntPtr h,uint m);[DllImport(\"kernel32.dll\")]public static extern IntPtr GetStdHandle(int n);[DllImport(\"kernel32.dll\")]public static extern bool GetConsoleMode(IntPtr h,out uint m);' -Namespace K; $h=K.W.GetStdHandle(-11);$m=0;K.W.GetConsoleMode($h,[ref]$m);K.W.SetConsoleMode($h,$m -bor 4)" >nul 2>&1

:: __ ESC karakteri ve Renk Ayarlari __________________________________________
set "ESC="
for /f "delims=" %%a in ('echo prompt $E^| cmd /q /k "exit"') do if not defined ESC set "ESC=%%a"

if defined ESC (
    set "R=%ESC%[0m"
    set "RED=%ESC%[91m"
    set "GRN=%ESC%[92m"
    set "YLW=%ESC%[93m"
    set "CYN=%ESC%[96m"
    set "WHT=%ESC%[97m"
    set "GRY=%ESC%[90m"
    set "BLD=%ESC%[1m"
) else (
    set "R=" & set "RED=" & set "GRN=" & set "YLW=" & set "CYN=" & set "WHT=" & set "GRY=" & set "BLD="
)

:: __ Dil tespiti ______________________________________________________________
set "_LANG=en"
for /f "tokens=3" %%a in ('reg query "HKCU\Control Panel\International" /v LocaleName 2^>nul') do set "_LOCALE=%%a"
if defined _LOCALE (
    set "_LC2=!_LOCALE:~0,2!"
    if "!_LC2!"=="tr" set "_LANG=tr"
    if "!_LC2!"=="de" set "_LANG=de"
    if "!_LC2!"=="fr" set "_LANG=fr"
    if "!_LC2!"=="es" set "_LANG=es"
    if "!_LC2!"=="pt" set "_LANG=pt"
    if "!_LC2!"=="it" set "_LANG=it"
    if "!_LC2!"=="ru" set "_LANG=ru"
)

call :set_lang_!_LANG! 2>nul
if errorlevel 1 call :set_lang_en
goto :main

:set_lang_en
set "T=YouTube Shorts Blocker - Native Host Setup"
set "T1=Checking for yt-dlp.exe..."
set "T2=yt-dlp.exe not found. Downloading latest version..."
set "T3=yt-dlp.exe is ready."
set "T4=Failed to download yt-dlp.exe. Please download it manually."
set "T5=Enter the Extension ID shown on the setup page:"
set "T6=(looks like: ceemcdspjoljphnaahlegionfifdppbm)"
set "T7=Error: Extension ID cannot be blank."
set "T8=Generating native host manifest..."
set "T9=Error: Node.js is required. Download from https://nodejs.org/"
set "T10=Registering native host with Chrome..."
set "T11=Installation complete! Return to Chrome and click Check Again."
set "T12=Failed to write registry key. Try running as Administrator."
set "T13=Press any key to close..."
exit /b 0

:set_lang_tr
set "T=YouTube Shorts Engelleyici - Yerel Host Kurulumu"
set "T1=yt-dlp.exe kontrol ediliyor..."
set "T2=yt-dlp.exe bulunamadi. En son surum indiriliyor..."
set "T3=yt-dlp.exe hazir."
set "T4=yt-dlp.exe indirilemedi. Lutfen manuel olarak bu klasore koyun."
set "T5=Kurulum sayfasindaki Uzanti Kimligini girin:"
set "T6=(ornek: ceemcdspjoljphnaahlegionfifdppbm)"
set "T7=Hata: Uzanti Kimligi bos birakilamaz."
set "T8=Yerel host bildirimi olusturuluyor..."
set "T9=Hata: Node.js gerekli. https://nodejs.org/ adresinden indirin."
set "T10=Yerel host Chrome a kaydediliyor..."
set "T11=Kurulum tamamlandi! Chrome a donup Tekrar Kontrol Et e tiklayin."
set "T12=Kayit defteri yazilamadi. Yonetici olarak calistirin."
set "T13=Kapatmak icin herhangi bir tusa basin..."
exit /b 0

:set_lang_de
set "T=YouTube Shorts Blocker - Native Host Installation"
set "T1=Suche nach yt-dlp.exe..."
set "T2=yt-dlp.exe nicht gefunden. Neueste Version wird heruntergeladen..."
set "T3=yt-dlp.exe ist bereit."
set "T4=Download fehlgeschlagen. Bitte manuell in diesen Ordner legen."
set "T5=Erweiterungs-ID von der Einrichtungsseite eingeben:"
set "T6=(Beispiel: ceemcdspjoljphnaahlegionfifdppbm)"
set "T7=Fehler: Erweiterungs-ID darf nicht leer sein."
set "T8=Native Host Manifest wird erstellt..."
set "T9=Fehler: Node.js erforderlich. Download: https://nodejs.org/"
set "T10=Native Host wird bei Chrome registriert..."
set "T11=Installation abgeschlossen! Zurueck zu Chrome, Erneut pruefen."
set "T12=Registry-Schluessel nicht schreibbar. Als Administrator ausfuehren."
set "T13=Zum Beenden beliebige Taste druecken..."
exit /b 0

:set_lang_fr
set "T=Bloqueur YouTube Shorts - Installation hote natif"
set "T1=Recherche de yt-dlp.exe..."
set "T2=yt-dlp.exe introuvable. Telechargement en cours..."
set "T3=yt-dlp.exe est pret."
set "T4=Echec du telechargement. Placez-le manuellement dans ce dossier."
set "T5=Entrez l ID extension de la page de configuration:"
set "T6=(exemple: ceemcdspjoljphnaahlegionfifdppbm)"
set "T7=Erreur: l ID extension ne peut pas etre vide."
set "T8=Generation du manifeste hote natif..."
set "T9=Erreur: Node.js requis. Telechargez sur https://nodejs.org/"
set "T10=Enregistrement hote natif dans Chrome..."
set "T11=Installation terminee! Retournez dans Chrome, cliquez Verifier."
set "T12=Impossible d ecrire la cle de registre. Essayez en administrateur."
set "T13=Appuyez sur une touche pour quitter..."
exit /b 0

:set_lang_es
set "T=Bloqueador YouTube Shorts - Instalacion host nativo"
set "T1=Buscando yt-dlp.exe..."
set "T2=yt-dlp.exe no encontrado. Descargando ultima version..."
set "T3=yt-dlp.exe esta listo."
set "T4=Error al descargar. Colocalo manualmente en esta carpeta."
set "T5=Introduce el ID de extension de la pagina de configuracion:"
set "T6=(ejemplo: ceemcdspjoljphnaahlegionfifdppbm)"
set "T7=Error: el ID de extension no puede estar vacio."
set "T8=Generando manifiesto del host nativo..."
set "T9=Error: Node.js es necesario. Descargalo en https://nodejs.org/"
set "T10=Registrando el host nativo en Chrome..."
set "T11=Instalacion completada! Vuelve a Chrome y haz clic en Comprobar."
set "T12=No se pudo escribir la clave de registro. Ejecuta como Administrador."
set "T13=Pulsa cualquier tecla para salir..."
exit /b 0

:set_lang_pt
set "T=Bloqueador YouTube Shorts - Instalacao host nativo"
set "T1=Procurando yt-dlp.exe..."
set "T2=yt-dlp.exe nao encontrado. Baixando versao mais recente..."
set "T3=yt-dlp.exe esta pronto."
set "T4=Falha ao baixar. Coloque-o manualmente nesta pasta."
set "T5=Digite o ID de extensao da pagina de configuracao:"
set "T6=(exemplo: ceemcdspjoljphnaahlegionfifdppbm)"
set "T7=Erro: o ID de extensao nao pode estar vazio."
set "T8=Gerando manifesto do host nativo..."
set "T9=Erro: Node.js necessario. Baixe em https://nodejs.org/"
set "T10=Registrando o host nativo no Chrome..."
set "T11=Instalacao concluida! Volte ao Chrome e clique em Verificar."
set "T12=Nao foi possivel gravar a chave de registro. Execute como Administrador."
set "T13=Pressione qualquer tecla para sair..."
exit /b 0

:set_lang_it
set "T=Blocca YouTube Shorts - Installazione host nativo"
set "T1=Ricerca di yt-dlp.exe..."
set "T2=yt-dlp.exe non trovato. Download ultima versione..."
set "T3=yt-dlp.exe e pronto."
set "T4=Download non riuscito. Inseriscilo manualmente in questa cartella."
set "T5=Inserisci l ID estensione dalla pagina di configurazione:"
set "T6=(esempio: ceemcdspjoljphnaahlegionfifdppbm)"
set "T7=Errore: l ID estensione non puo essere vuoto."
set "T8=Generazione manifest host nativo..."
set "T9=Errore: Node.js necessario. Scaricalo da https://nodejs.org/"
set "T10=Registrazione host nativo in Chrome..."
set "T11=Installazione completata! Torna a Chrome e clicca Ricontrolla."
set "T12=Impossibile scrivere la chiave di registro. Esegui come Amministratore."
set "T13=Premi un tasto per uscire..."
exit /b 0

:set_lang_ru
set "T=YouTube Shorts Blocker - Ustanovka nativnogo hosta"
set "T1=Poisk yt-dlp.exe..."
set "T2=yt-dlp.exe ne najden. Zagruzka poslednej versii..."
set "T3=yt-dlp.exe gotov."
set "T4=Zagruzka ne udalas. Pomestite fail vruchnuyu v etu papku."
set "T5=Vvedite ID rasshireniya so stranitsy nastrojki:"
set "T6=(primer: ceemcdspjoljphnaahlegionfifdppbm)"
set "T7=Oshibka: ID rasshireniya ne mozhet byt pustym."
set "T8=Sozdanie manifesta nativnogo hosta..."
set "T9=Oshibka: trebuetsya Node.js. Skachayte na https://nodejs.org/"
set "T10=Registratsiya nativnogo hosta v Chrome..."
set "T11=Ustanovka zavershena! Vernis v Chrome i nazhmi Proverit snova."
set "T12=Ne udalos zapisat klyuch reestra. Zapustite ot imeni administratora."
set "T13=Nazhmite lyubuyu klavishu dlya vyhoda..."
exit /b 0

:: ============================================================================
::  ANA ISLEM
:: ============================================================================
:main
cls
echo.
echo   %BLD%%WHT%%T%%R%
echo   %GRY%Paracci Browser Tools - github.com/paracci%R%
echo.
echo   %GRY%--------------------------------------------------------%R%
echo.

set "DIR=%~dp0"
set "DIR=%DIR:~0,-1%"

:: ============================================================================
::  ADIM 1 - yt-dlp.exe
:: ============================================================================
echo   %CYN%[1/3]%R%  %T1%
echo.

if not exist "%DIR%\yt-dlp.exe" (
    echo   %YLW%  ^> %T2%%R%
    echo.
    curl -L --progress-bar "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -o "%DIR%\yt-dlp.exe"
    if !errorlevel! equ 0 (
        echo.
        echo   %GRN%  [OK]  %T3%%R%
    ) else (
        echo.
        echo   %RED%  [FAIL]  %T4%%R%
        goto :end_fail
    )
) else (
    echo   %GRN%  [OK]  %T3%%R%
)
echo.
echo   %GRY%--------------------------------------------------------%R%
echo.

:: ============================================================================
::  ADIM 2 - Extension ID
:: ============================================================================
echo   %CYN%[2/3]%R%  %T5%
echo   %GRY%         %T6%%R%
echo.
set "EXTENSION_ID="
set /p "EXTENSION_ID=   ID: "
echo.
if "!EXTENSION_ID!"=="" (
    echo   %RED%  [FAIL]  %T7%%R%
    goto :end_fail
)
echo.
echo   %GRY%--------------------------------------------------------%R%
echo.

:: ============================================================================
::  ADIM 3 - Manifest + Registry
:: ============================================================================
echo   %CYN%[3/3]%R%  %T8%

set "MANIFEST=%DIR%\com.paracci.youtubedownloader.json"
set "REG_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.paracci.youtubedownloader"
set "MANIFEST_FWD=%MANIFEST:\=/%"
set "HOST_JSON=%DIR:\=\\%\\\\native-host.bat"
set "EXT_ID=!EXTENSION_ID!"

node -e "var fs=require('fs');var m={name:'com.paracci.youtubedownloader',description:'YouTube Shorts Blocker',path:'%HOST_JSON%',type:'stdio',allowed_origins:['chrome-extension://%EXT_ID%/']};fs.writeFileSync('%MANIFEST_FWD%',JSON.stringify(m,null,2));" 2>nul
if !errorlevel! neq 0 (
    echo.
    echo   %RED%  [FAIL]  %T9%%R%
    goto :end_fail
)

echo   %CYN%  ^> %T10%%R%
(
    echo @echo off
    echo node "%%~dp0native-host.js" %%*
) > "%DIR%\native-host.bat"

reg add "%REG_KEY%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul 2>&1
if !errorlevel! equ 0 (
    echo.
    echo   %GRN%  [OK]  %BLD%%T11%%R%
    goto :end_ok
) else (
    echo.
    echo   %RED%  [FAIL]  %T12%%R%
    echo.
    goto :end_fail
)

:end_ok
echo.
echo   %GRY%  %T13%%R%
pause >nul
exit /b 0

:end_fail
echo.
echo   %GRY%  %T13%%R%
pause >nul
exit /b 1