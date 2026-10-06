@echo off
REM Duplo clique: envia a previsao de hoje AGORA para os grupos cadastrados.
REM Para o robo antes e sobe de novo no fim (duas conexoes na mesma sessao do WhatsApp se derrubam).
cd /d "%~dp0"
set "PM2=pm2"
if exist "%APPDATA%\npm\pm2.cmd" set "PM2=%APPDATA%\npm\pm2.cmd"

echo Pausando o robo...
call "%PM2%" stop previsao-tempo-obras >nul 2>&1

echo Enviando a previsao...
call node scripts\relatorio-agora.js --forcar

echo Religando o robo...
call "%PM2%" start ecosystem.config.cjs >nul 2>&1

echo.
echo Pronto. Confira o grupo no WhatsApp.
pause
