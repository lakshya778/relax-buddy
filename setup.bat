@echo off
echo =========================
echo RelaxBuddy Setup
echo =========================

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python not installed! Install Python first.
    pause
    exit /b
)

cd backend

echo Creating virtual environment...
python -m venv venv

echo Installing dependencies...
venv\Scripts\pip install -r requirements.txt

echo Setup completed!
pause
