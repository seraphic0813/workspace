@echo off
title EVM Dashboard Launcher
echo ========================================================
echo   EVM Dashboard Local Server Launcher
echo ========================================================
echo.
echo Starting python API server on port 8000...
start "EVM_Dashboard_Backend" python "%~dp0server.py"
timeout /t 2 >nil
echo Opening dashboard in your default browser...
start http://localhost:8000/index.html
echo.
echo ========================================================
echo   Backend server is active.
echo   Press Ctrl+C inside the backend window to terminate.
echo ========================================================
exit
