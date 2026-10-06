@echo off
REM Duplo clique: manda uma mensagem de EXEMPLO (chuva ficticia das 14h as 17h) para os grupos.
REM Use quando nao ha chuva prevista e voce precisa mostrar o formato da mensagem.
REM Nao altera o relatorio real do dia (usa um arquivo de estado descartavel).
cd /d "%~dp0"
set "PM2=pm2"
if exist "%APPDATA%\npm\pm2.cmd" set "PM2=%APPDATA%\npm\pm2.cmd"

echo Pausando o robo...
call "%PM2%" stop previsao-tempo-obras >nul 2>&1

echo Enviando mensagem de EXEMPLO...
call node scripts\relatorio-agora.js --exemplo

echo Religando o robo...
call "%PM2%" start ecosystem.config.cjs >nul 2>&1

echo.
echo Pronto. Confira o grupo no WhatsApp.
pause
