@echo off
REM Запуск dev-сервера игры feese-pet. Не закрывай это окно, пока играешь.
cd /d "%~dp0"
echo Starting feese-pet... open http://localhost:5173/ in your browser.
call npm run dev
pause
