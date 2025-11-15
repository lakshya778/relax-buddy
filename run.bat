@echo off
echo =========================
echo Starting RelaxBuddy...
echo =========================

REM Start backend
cd backend
start "" cmd /k "venv\Scripts\activate && python app.py"

REM Start frontend
cd ..
cd frontend
start "" cmd /k "python -m http.server 8000"

echo Backend and Frontend started!
pause
