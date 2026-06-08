@echo off
rem コンソールを UTF-8 に切り替え（日本語の文字化け・誤実行を防止）
chcp 65001 >nul
title EVM Dashboard Backend Server
echo ========================================================
echo   EVM Dashboard Backend Server
echo ========================================================
echo.
echo Starting backend server on port 8000...
echo.
echo   [INFO] サーバー起動後、ブラウザで以下にアクセスしてください:
echo          http://localhost:8000/index.html
echo.
echo   [INFO] サーバーを停止するには Ctrl+C を押してください。
echo ========================================================
echo.
python "%~dp0server.py"
pause
