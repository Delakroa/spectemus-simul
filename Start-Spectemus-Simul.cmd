@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Spectemus Simul Host

cd /d "%~dp0"

where pnpm.cmd >nul 2>&1
if errorlevel 1 goto :missing_pnpm

docker.exe version --format "{{.Server.Version}}" >nul 2>&1
if errorlevel 1 goto :missing_docker

echo Запускаем Spectemus Simul Host для домашней сети...
call pnpm.cmd host:lan:start
if errorlevel 1 goto :start_failed

for /f "tokens=1,* delims==" %%A in ('findstr /b "LIVEKIT_NODE_IP=" "infra\lan.env"') do set "SPECTEMUS_HOST_IP=%%B"
if not defined SPECTEMUS_HOST_IP goto :address_failed

start "" "http://%SPECTEMUS_HOST_IP%:8088"
exit /b 0

:missing_pnpm
echo.
echo Не найден pnpm. Один раз установите Node.js LTS и pnpm, затем повторите запуск.
goto :failed

:missing_docker
echo.
echo Docker Desktop не запущен. Откройте Docker Desktop, дождитесь статуса Running и повторите запуск.
goto :failed

:start_failed
echo.
echo Не удалось запустить Host mode. Прочитайте сообщение выше и повторите после исправления причины.
goto :failed

:address_failed
echo.
echo Host mode запущен, но не удалось прочитать его LAN-адрес.

:failed
echo.
pause
exit /b 1
