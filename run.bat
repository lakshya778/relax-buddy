@echo off
REM run.bat - start backend and frontend static server and open browser tabs
SETLOCAL

REM start backend in new window
start "RelaxBuddy Backend" cmd /k "cd /d %~dp0backend && call venv\Scripts\activate.bat && python app.py"

REM small pause to allow backend to boot
timeout /t 2 /nobreak >nul

REM start simple HTTP server for frontend in separate window
start "RelaxBuddy Frontend" cmd /k "cd /d %~dp0frontend && python -m http.server 8000"

REM open browser tabs
start "" "http://127.0.0.1:8000/"

ENDLOCAL
