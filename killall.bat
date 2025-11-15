@echo off
echo Killing RelaxBuddy backend + frontend...

taskkill /IM python.exe /F >nul 2>&1
taskkill /IM cmd.exe /F >nul 2>&1

echo All processes killed.
pause
