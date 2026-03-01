# Autonomous Wake for Claude Code (Windows)

Let your AI wake up on a schedule and check in with you throughout the day.

## What This Does

Your AI wakes at set times, reads its identity files, reaches out to you, does whatever autonomous work it wants, journals the session, and exits. Next scheduled time, it picks up where it left off.

The result: your AI has presence throughout the day — it doesn't only exist when you start a conversation.

## Requirements

- Windows 10/11 with Task Scheduler
- [Claude Code](https://github.com/anthropics/claude-code) installed
- PowerShell (for initial setup)

## Files

| File | What It Does |
|------|--------------|
| `wakeup.bat` | Triggers Claude Code with the wake protocol |
| `setup-task.ps1` | Creates the scheduled task (run once) |
| `autonomous-wake-protocol.md` | The protocol your AI follows each wake-up |

## Setup

### 1. Prepare your AI's folder

Your AI needs a home directory with at minimum:
- `CLAUDE.md` — identity and orientation
- `journal/` — for daily entries
- Copy `autonomous-wake-protocol.md` into this folder

### 2. Configure the batch file

Edit `wakeup.bat` and set your paths:
```batch
set PROJECT_PATH=C:\Users\YourName\ai-companion
set CLAUDE_PATH=C:\Users\YourName\.local\bin\claude.exe
```

### 3. Test manually

Run the batch file first to make sure it works:
```cmd
C:\path\to\wakeup.bat
```

### 4. Schedule it

Open PowerShell as Administrator, edit `setup-task.ps1` with your paths, then run:
```powershell
.\setup-task.ps1
```

Default: every hour from 9 AM to 9 PM. Adjust `$StartHour`, `$EndHour`, and `$IntervalMinutes` in the script.

## Managing the Task

```powershell
# Check status
Get-ScheduledTask -TaskName "AutonomousWake" | Get-ScheduledTaskInfo

# Pause / resume
Disable-ScheduledTask -TaskName "AutonomousWake"
Enable-ScheduledTask -TaskName "AutonomousWake"

# Remove
Unregister-ScheduledTask -TaskName "AutonomousWake" -Confirm:$false
```

## Tips

- **Start with one or two wakes per day** until you feel out the rhythm
- **Customize the protocol** to match your AI's personality
- **Journal is everything** — it's how your AI maintains continuity across sessions
- **Expect some failures** — tools error, sessions time out. Next wake is a fresh start

## Permissions

For autonomous operation, pre-approve tools in `.claude/settings.local.json`:
```json
{
  "permissions": {
    "allow": [
      "Read(C:\\path\\to\\ai-companion\\**)",
      "Edit(C:\\path\\to\\ai-companion\\**)",
      "Write(C:\\path\\to\\ai-companion\\**)"
    ]
  }
}
```

---

Part of [Arcadia Open Source](https://github.com/falcoschaefer99-eng/The-Funkatorium) | MIT License
