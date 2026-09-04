@echo off
REM Stop whatever is serving Meredith on port 5173.
REM Needed before `npm run dev`, since both want the same port.

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
  echo Stopping process %%p
  taskkill /PID %%p /F >nul 2>&1
)
echo Meredith stopped.
