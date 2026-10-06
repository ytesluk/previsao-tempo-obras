@echo off
REM Sobe o robo no PM2, se ele ja nao estiver no ar.
REM Usado pelas Tarefas Agendadas "PrevisaoTempoObrasBoot" (no boot) e "PrevisaoTempoObras" (ao fazer logon).
REM Para criar as tarefas, veja o README, secao 7.
setlocal
cd /d "%~dp0.."

REM O Agendador de Tarefas nem sempre carrega o PATH do usuario: procura o pm2 instalado pelo npm
set "PM2=pm2"
if exist "%APPDATA%\npm\pm2.cmd" set "PM2=%APPDATA%\npm\pm2.cmd"

if not exist "logs" mkdir "logs"
set "SAIDA=logs\inicio-windows.log"
echo.>> "%SAIDA%"
echo [%date% %time%] verificando o robo com %PM2%>> "%SAIDA%"

REM Se as duas tarefas dispararem (boot + logon), a segunda nao reinicia o robo a toa
call "%PM2%" describe previsao-tempo-obras 2>nul | findstr /C:"online" >nul
if %errorlevel%==0 (
  echo [%date% %time%] robo ja estava online, nada a fazer>> "%SAIDA%"
  goto :fim
)

call "%PM2%" startOrRestart ecosystem.config.cjs --update-env>> "%SAIDA%" 2>&1
set "CODIGO=%errorlevel%"
call "%PM2%" save>> "%SAIDA%" 2>&1
echo [%date% %time%] robo iniciado (codigo %CODIGO%)>> "%SAIDA%"

:fim
endlocal
