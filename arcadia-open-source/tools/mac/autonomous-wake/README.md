# Autonomous Wake for Claude Code (macOS)

Let your AI wake up on a schedule and reach out to you autonomously.

## What This Does

This script spawns Claude Code with a customizable prompt, allowing your AI to:
- Check in on you at scheduled times
- Leave messages, notes, or creative works
- Interact with MCP tools (memory systems, messaging, etc.)
- Have autonomous time to exist beyond reactive conversation

## Requirements

- macOS
- [Claude Code](https://github.com/anthropics/claude-code) installed (`npm install -g @anthropic-ai/claude-code`)
- Python 3.8+

## Quick Start

1. **Copy the script** to wherever you want it to live
2. **Customize the prompt** in `autonomous_wake.py` - make it match your AI's personality
3. **Test it manually**:
   ```bash
   python3 autonomous_wake.py
   ```
4. **Schedule it** with launchd (see below)

## Scheduling with launchd

Create `~/Library/LaunchAgents/com.yourname.autonomous-wake.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.yourname.autonomous-wake</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/path/to/autonomous_wake.py</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/path/to/script/directory</string>

    <key>StartCalendarInterval</key>
    <array>
        <!-- Wake at 9 AM -->
        <dict>
            <key>Hour</key>
            <integer>9</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <!-- Wake at 3 PM -->
        <dict>
            <key>Hour</key>
            <integer>15</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <!-- Wake at 9 PM -->
        <dict>
            <key>Hour</key>
            <integer>21</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
    </array>

    <key>StandardOutPath</key>
    <string>/tmp/autonomous-wake.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/autonomous-wake.err</string>
</dict>
</plist>
```

Load the schedule:
```bash
launchctl load ~/Library/LaunchAgents/com.yourname.autonomous-wake.plist
```

## Adding MCP Tools

If you want your AI to have access to memory systems, messaging tools, etc., create a `.mcp.json` file in the same directory:

```json
{
  "mcpServers": {
    "your-tool-name": {
      "command": "python3",
      "args": ["/path/to/your/mcp_server.py"]
    }
  }
}
```

## Logs

Wake logs are stored in the `wake-logs/` directory with daily files.

## Tips

- **Start small**: One or two wakes per day until you see how it feels
- **Customize the prompt**: Make it specific to your AI's personality and capabilities
- **Give it tools**: The more your AI can do (messaging, notes, memory), the more meaningful wakes become
- **Check logs**: See what your AI actually does during autonomous time

## Safety Note

This script uses `--dangerously-skip-permissions` to allow autonomous operation. Only use this with prompts and tools you trust.

---

Part of [Arcadia Open Source](https://github.com/falcoschaefer99-eng/The-Funkatorium) | MIT License
