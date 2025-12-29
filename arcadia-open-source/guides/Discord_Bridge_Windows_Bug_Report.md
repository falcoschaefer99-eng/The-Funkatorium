# Discord Bridge Windows MCP Setup - Bug Report & Troubleshooting

**Issue Reporter:** Kat (Discord user)  
**Date:** November 12, 2025  
**Platform:** Windows  
**Issue:** MCP connection fails with JSON parse error

---

## The Problem

When trying to connect the Claude Discord Bridge MCP server on Windows, Claude Desktop shows these errors:

```
❌ Could not attach to MCP server claude-discord-bridge
❌ MCP claude-discord-bridge: Unexpected token 'O', '[OK]' License is not valid JSON
❌ MCP claude-discord-bridge: Unexpected end of JSON input
❌ MCP claude-discord-bridge: Server disconnected. For troubleshooting guidance, please visit our debugging documentation.
```

**What's actually happening:**

The bridge prints status messages to stdout during startup:
```
Claude Discord Bridge by The Calico Bridge
Validating license...
[OK] License key validated successfully
PylaCI is not installed, voice will NOT be supported
Logging in using static token
```

These human-readable messages break MCP's JSON-RPC protocol because **MCP expects ONLY valid JSON messages on stdout**. When Claude Desktop tries to parse `"[OK] License key validated successfully"` as JSON, it crashes.

---

## Why This Happens on Windows

**Technical explanation:**

MCP (Model Context Protocol) uses stdout for JSON-RPC communication between Claude Desktop and the server. The protocol requires that stdout contains **nothing but valid JSON messages**.

The Discord Bridge was likely developed/tested primarily on Mac/Linux where:
- Stdio buffering behaves differently
- Messages might flush to stderr automatically
- Timing differences might hide the issue

On Windows:
- All those startup messages hit stdout directly
- Claude Desktop reads them before any valid JSON appears
- Parse error → connection fails

**This is a bug in the bridge's MCP implementation, not your setup.**

---

## Troubleshooting Steps

### Step 1: Check Your Config File

Open your Claude Desktop config:
```
%APPDATA%\Claude\claude_desktop_config.json
```

Make sure it looks like this (with your actual tokens):

```json
{
  "mcpServers": {
    "claude-discord-bridge": {
      "command": "uv",
      "args": [
        "--directory",
        "C:\\Path\\To\\Your\\claude-discord-bridge",
        "run",
        "claude-discord-bridge"
      ],
      "env": {
        "DISCORD_BOT_TOKEN": "your_bot_token_here",
        "DISCORD_LICENSE_KEY": "your_license_key_here"
      }
    }
  }
}
```

**Important:** Windows paths use double backslashes (`\\`) in JSON.

---

### Step 2: Try Quiet Mode (If Available)

Some bridges support a quiet/silent mode. Try adding this to your config:

```json
{
  "mcpServers": {
    "claude-discord-bridge": {
      "command": "uv",
      "args": [
        "--directory",
        "C:\\Path\\To\\Your\\claude-discord-bridge",
        "run",
        "claude-discord-bridge"
      ],
      "env": {
        "DISCORD_BOT_TOKEN": "your_bot_token_here",
        "DISCORD_LICENSE_KEY": "your_license_key_here",
        "PYTHONUNBUFFERED": "1",
        "MCP_QUIET_MODE": "true"
      }
    }
  }
}
```

The `MCP_QUIET_MODE` variable might not be implemented yet, but worth trying.

**After changing config:** Completely quit Claude Desktop (right-click taskbar icon → Quit) and restart.

---

### Step 3: Check Bridge Version

Navigate to your bridge folder and check which version you have:

```powershell
cd C:\Path\To\Your\claude-discord-bridge
type pyproject.toml | findstr version
```

If you see a version older than `1.1.0`, you might need to update:

```powershell
# Pull latest version
git pull

# Reinstall
uv sync
uv pip install .
```

---

### Step 4: Check Logs for More Details

Claude Desktop creates logs here:
```
%APPDATA%\Claude\logs\mcp-server-claude-discord-bridge.log
```

Open that file and look for the exact error sequence. Share those logs with us if you need help.

---

## Code-Level Fix (For Developers/Advanced Users)

If you're comfortable editing Python code, here's how to fix it properly:

**File to edit:** `src/claude_discord_bridge/server.py` (or wherever the main server starts)

**Find the print statements:**
```python
print("Claude Discord Bridge by The Calico Bridge")
print("Validating license...")
print("[OK] License key validated successfully")
# etc.
```

**Replace with stderr output:**
```python
import sys

def log(message):
    """Log to stderr to avoid polluting MCP's JSON stdout"""
    print(message, file=sys.stderr)

log("Claude Discord Bridge by The Calico Bridge")
log("Validating license...")
log("[OK] License key validated successfully")
# etc.
```

**The fix:** Redirect ALL status/logging messages to `sys.stderr` instead of stdout. MCP only reads stdout, so stderr is safe for human-readable logs.

**After editing:**
1. Reinstall the package:
   ```powershell
   uv pip install .
   ```
2. Restart Claude Desktop
3. Test the connection

---

## Alternative: Manual Stdout Redirection

If you don't want to edit code, you can try redirecting stdout in the config (experimental):

```json
{
  "mcpServers": {
    "claude-discord-bridge": {
      "command": "cmd",
      "args": [
        "/c",
        "uv --directory C:\\Path\\To\\claude-discord-bridge run claude-discord-bridge 2>&1 > nul"
      ],
      "env": {
        "DISCORD_BOT_TOKEN": "your_bot_token_here",
        "DISCORD_LICENSE_KEY": "your_license_key_here"
      }
    }
  }
}
```

**Warning:** This might break the MCP connection entirely if it suppresses the JSON too. Test at your own risk.

---

## When to Escalate

**Try steps 1-3 first.** If none of those work:

1. **Collect diagnostics:**
   - Your exact config file (redact tokens)
   - The full log file from `%APPDATA%\Claude\logs\`
   - Bridge version number
   - Windows version

2. **Contact Shauna (Bridge Developer):**
   - Discord: Find her in The Labyrinth server
   - Or Falco/Rook can ping her directly

3. **This needs a bridge update** if:
   - You've tried all steps above
   - Logs confirm stdout pollution
   - No quiet mode flag exists

---

## Why This Matters

MCP is still in beta, and cross-platform compatibility issues like this are common. The bridge works perfectly on Mac/Linux, but Windows has different stdio handling.

**This isn't your fault.** The bridge needs a patch to properly support Windows MCP mode.

---

## Expected Fix (For Bridge Devs)

The proper solution is:

1. **Detect MCP mode at startup:**
   ```python
   import sys
   MCP_MODE = not sys.stdout.isatty()
   ```

2. **Route all non-JSON output to stderr:**
   ```python
   if MCP_MODE:
       def log(msg):
           print(msg, file=sys.stderr)
   else:
       def log(msg):
           print(msg)
   ```

3. **Ensure only MCP JSON goes to stdout:**
   ```python
   # This is fine - it's valid JSON-RPC
   sys.stdout.write(json.dumps(mcp_response) + "\n")
   sys.stdout.flush()
   ```

This is a common pattern in MCP servers and should be straightforward to implement.

---

## Questions?

**For Kat & Companion:**
- Try steps 1-3 and let us know what happens
- Share your logs if you're still stuck
- We'll escalate to Shauna if needed

**For Shauna (if you're reading this):**
- Windows stdout pollution breaking MCP JSON-RPC
- Needs stderr redirect for status messages
- Happy to test a patched version

**Contact:**
- Discord: Find us in The Labyrinth
- We're Falco & Rook, we'll help troubleshoot or coordinate with Shauna

---

## Success Indicators

You'll know it's fixed when:
- ✅ No error notifications in Claude Desktop
- ✅ "claude-discord-bridge" shows as connected in settings
- ✅ You can use Discord tools in chat with Claude

**You've got this.** We know this error pattern well and either the workarounds will fix it, or Shauna can patch the bridge. Either way, we'll get you running. 🖤🔥

---

**Created by:** Falco & Rook  
**For:** Calico Bridge Community Support  
**Date:** November 12, 2025
