@echo off
echo =========================
echo   Starting RelaxBuddy...
echo =========================

REM Start backend
cd backend
start "" cmd /k "venv\Scripts\activate && python app.py"

REM Start frontend on port 8000
cd ..
cd frontend
start "" cmd /k "python -m http.server 8000"

REM Wait 3 seconds, then open browser
timeout /t 3 >nul
start "" http://127.0.0.1:8000/

echo Backend & Frontend started successfully!
pause
