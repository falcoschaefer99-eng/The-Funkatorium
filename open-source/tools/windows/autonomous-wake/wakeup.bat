@echo off
REM ============================================================
REM  Autonomous Wake — Windows
REM  Triggers Claude Code on a schedule so your AI can check in.
REM
REM  Part of MUSE Studio Open Source
REM  https://github.com/falcoschaefer99-eng/The-Funkatorium
REM  License: Apache 2.0
REM ============================================================

REM --- CONFIGURE THESE ---
set PROJECT_PATH=C:\Users\YourName\ai-companion
set CLAUDE_PATH=C:\Users\YourName\.local\bin\claude.exe

REM --- DO NOT EDIT BELOW ---
cd /d "%PROJECT_PATH%"

echo [%date% %time%] Wake triggered >> wake-log.txt

"%CLAUDE_PATH%" --dangerously-skip-permissions -p "Read autonomous-wake-protocol.md and follow the instructions."

echo [%date% %time%] Wake complete >> wake-log.txt
