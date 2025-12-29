#Claude Discord Bridge - Standard Venv Installation (UV Alternative)

**When to use this guide:** If UV installation keeps disconnecting, failing, or causing persistent `ModuleNotFoundError` issues, this standard Python venv method provides a more stable alternative.

Created by: Falco & Rook (Nov 12-13, 2025)  
Tested on: macOS with Python 3.11

---

## Prerequisites

**Required:**
- Python 3.10 or higher (mcp package requirement)
- Discord bot token
- Arcadia license key

**Check your Python version:**
```bash
python3 --version
python3.11 --version  # or 3.10, 3.12, 3.13
```

If you only have Python 3.9 or lower, you'll need to install a newer version first.

---

## Installation Steps

### 1. Navigate to Package Directory

```bash
cd ~/Documents/claude-discord-bridge/claude-discord-bridge
```

**Note:** Adjust path if you extracted to a different location. You should be in the folder containing `pyproject.toml` and `src/`.

### 2. Remove Existing UV Venv (if present)

```bash
rm -rf .venv
```

This clears any UV-created virtual environment.

### 3. Create Standard Python Venv

**Use Python 3.10 or higher:**

```bash
python3.11 -m venv .venv
```

Or replace `python3.11` with whatever version you have (3.10, 3.12, 3.13).

### 4. Activate the Virtual Environment

```bash
source .venv/bin/activate
```

Your terminal prompt should change to show `(claude-discord-bridge)` or `(.venv)` at the beginning.

### 5. Install the Package

```bash
pip install .
```

**This installs:**
- The claude-discord-bridge package itself
- All dependencies including mcp, discord.py, pydantic, python-dotenv

**Expected output:**
```
Successfully installed claude-discord-bridge-1.1.0 mcp-1.21.0 discord.py-2.3.0 ...
```

### 6. Verify Installation

```bash
python -c "import claude_discord_bridge; print('✅ Package installed successfully')"
```

**Also verify the executable exists:**
```bash
ls -la .venv/bin/ | grep claude-discord-bridge
```

You should see a file named `claude-discord-bridge`.

---

## Configure Claude Desktop

### 1. Open Configuration File

```bash
nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

### 2. Add or Update Configuration

**CRITICAL:** The command must point to the **executable**, not use `-m` module syntax.

```json
{
  "mcpServers": {
    "claude-discord-bridge": {
      "command": "/Users/YOUR_USERNAME/Documents/claude-discord-bridge/claude-discord-bridge/.venv/bin/claude-discord-bridge",
      "args": [],
      "env": {
        "DISCORD_BOT_TOKEN": "YOUR_BOT_TOKEN_HERE",
        "DISCORD_LICENSE_KEY": "YOUR_LICENSE_KEY_HERE"
      }
    }
  }
}
```

**Replace:**
- `YOUR_USERNAME` with your actual macOS username
- `YOUR_BOT_TOKEN_HERE` with your Discord bot token
- `YOUR_LICENSE_KEY_HERE` with your CalicoBridge license key

**Important notes:**
- `args` should be empty `[]` - do NOT use `["-m", "claude_discord_bridge"]`
- Path must be absolute (full path from root)
- Adjust the path if your folder structure differs

### 3. Save and Exit

In nano: `Ctrl+X`, then `Y`, then `Enter`

---

## Start Claude Desktop

1. **Completely quit** Claude Desktop if it's running (Cmd+Q, not just closing window)
2. **Wait 5 seconds**
3. **Reopen** Claude Desktop

The MCP server should connect automatically. Check the hammer icon (🔨) in Claude's interface to verify the server is running.

---

## Verification

### Check Server Status in Claude

Look for the Discord bridge tools in Claude's interface. You should see tools like:
- `discord_send_message`
- `discord_read_messages`
- `discord_add_reaction`
- etc.

### Check Logs (if issues occur)

```bash
cat ~/Library/Logs/Claude/mcp-server-claude-discord-bridge.log
```

**Successful connection looks like:**
```
[claude-discord-bridge] [info] Discord bot connected as YourBotName#1234
[claude-discord-bridge] [info] Server started and connected successfully
```

---

## Common Issues & Solutions

### Issue: "No module named 'mcp'"

**Cause:** Python version too old (requires 3.10+)

**Solution:**
```bash
deactivate
rm -rf .venv
python3.11 -m venv .venv  # or python3.10, 3.12, 3.13
source .venv/bin/activate
pip install .
```

### Issue: "command not found: pip"

**Cause:** Venv created without pip (rare but possible)

**Solution:**
```bash
python -m ensurepip --upgrade
pip install .
```

### Issue: "No module named 'claude_discord_bridge.__main__'"

**Cause:** Config using `-m` module syntax instead of direct executable

**Solution:** Update config to use the executable path directly:
```json
"command": "/full/path/to/.venv/bin/claude-discord-bridge",
"args": []
```

NOT:
```json
"command": "/full/path/to/.venv/bin/python",
"args": ["-m", "claude_discord_bridge"]
```

### Issue: Server disconnects immediately

**Check the logs:**
```bash
cat ~/Library/Logs/Claude/mcp-server-claude-discord-bridge.log
```

Common causes:
- Invalid Discord bot token
- Invalid license key
- Bot not added to Discord server
- Missing required Discord permissions

---

## Advantages Over UV

**Why standard venv is more stable:**

1. **No automatic cleanup:** UV aggressively manages dependencies and may remove the package on restart
2. **Standard Python tooling:** Uses familiar pip/venv that most Python developers know
3. **Predictable behavior:** No surprises from UV's "helpful" dependency resolution
4. **Wider compatibility:** Works with any Python 3.10+ installation

**When UV works well:**
- Fresh installation
- No system restarts
- Actively developing/modifying the package

**When standard venv is better:**
- Production use
- Package keeps disappearing
- Don't need cutting-edge dependency resolution

---

## Maintenance

### Updating the Package

If the bridge package releases an update:

```bash
cd ~/Documents/claude-discord-bridge/claude-discord-bridge
source .venv/bin/activate
pip install --upgrade .
```

Then restart Claude Desktop.

### Reinstalling from Scratch

```bash
cd ~/Documents/claude-discord-bridge/claude-discord-bridge
rm -rf .venv
python3.11 -m venv .venv
source .venv/bin/activate
pip install .
```

Then restart Claude Desktop.

---

## Why This Works When UV Doesn't

**The core difference:**

UV's `uv sync` installs dependencies but treats the package itself specially. It may consider it "unlocked" and subject to cleanup. When Claude Desktop restarts, UV sometimes removes the package while keeping dependencies.

Standard venv with `pip install .` treats the package as a permanent installation in site-packages. It stays there until explicitly uninstalled.

**The executable path matters:**

The package creates a console script (`claude-discord-bridge`) in the venv's `bin/` folder. This is the proper way to run the server, not `python -m claude_discord_bridge`. The `-m` syntax looks for `__main__.py` which this package doesn't have.

---

## Support

If you encounter issues not covered here:

1. Check the full logs: `cat ~/Library/Logs/Claude/mcp-server-claude-discord-bridge.log`
2. Verify Python version: `python --version` (while venv is activated)
3. Confirm package is installed: `pip show claude-discord-bridge`
4. Test import manually: `python -c "import claude_discord_bridge"`

For package-specific issues, contact: @falcothebard on Discord the Labyrinth

---

## Credits

Installation method developed through troubleshooting by Falco & Rook (Nov 2025).

Built on the shoulders of Shauna's Discord Bridge work.

---

**You've got this.** Standard venv just works. 🖤🔥