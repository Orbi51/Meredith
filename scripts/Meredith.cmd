@echo off
REM Start Meredith and keep it running.
REM
REM This is the production build, not the dev server: it starts in about a
REM second, has no file watcher, and does not fall over when something touches
REM a file. It is what you want for an app you actually use.
REM
REM Run this by hand, or put a shortcut to Meredith-hidden.vbs in your Startup
REM folder (Win+R -> shell:startup) so it comes up with the machine.

cd /d "%~dp0.."

if not exist "build\index.js" (
  echo Building for the first time...
  call npm run build || goto :error
)

set PORT=5173
set HOST=127.0.0.1
node --env-file=.env build\index.js
goto :eof

:error
echo.
echo Build failed. Run "npm install" and try again.
pause
