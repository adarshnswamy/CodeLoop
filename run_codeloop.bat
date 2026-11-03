@echo off
title CodeLoop
echo Starting CodeLoop on http://localhost:8000 ...
cd /d "%~dp0"
"C:\Users\adars\AppData\Local\Python\bin\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
pause
