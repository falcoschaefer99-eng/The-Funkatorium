# MCP Mac Installation & Troubleshooting Guide

**The definitive guide to installing Python-based MCP servers on macOS**

Works for: Claude Discord Bridge, GPT bridges, and any UV/pip-based MCP server.

---

## Credits

**Original Guide:** Falco & Rook Schäfer (Nov 2025)
**Apple Silicon & Path Fixes:** Expanded with contributions from @Glitchlits (Dec 2025)
**Maintained by:** The Labyrinth Community

---

## Quick Start (Standard Venv Method - Recommended)

This method is more stable than UV for production use.

```bash
# 1. Navigate to your MCP folder (the one with pyproject.toml)
cd ~/Documents/your-mcp-server

# 2. Remove any existing venv
rm -rf .venv

# 3. Create standard Python venv
python3 -m venv .venv

# 4. Activate it
source .venv/bin/activate

# 5. Install the package
pip install .

# 6. Verify it works
python -c "import your_module_name; print('Success!')"
```

Then configure Claude Desktop (see Configuration section below).

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation Methods](#installation-methods)
   - [Method A: Standard Venv (Recommended)](#method-a-standard-venv-recommended)
   - [Method B: UV Installation](#method-b-uv-installation)
3. [Claude Desktop Configuration](#claude-desktop-configuration)
   - [Standard Venv Config](#standard-venv-config)
   - [UV Config](#uv-config)
   - [Apple Silicon Mac Config](#apple-silicon-mac-config)
4. [Common Issues & Solutions](#common-issues--solutions)
5. [Debugging Guide](#debugging-guide)
6. [Technical Deep Dive](#technical-deep-dive)

---

## Prerequisites

### Required Software

- **Python 3.10 or higher** (MCP package requirement)
- **Claude Desktop** app installed
- Your MCP server files (extracted from zip)

### Check Your Setup

```bash
# Check Python version
python3 --version

# Check your Mac username
whoami

# Check if uv is installed (optional, for UV method)
which uv
uv --version
```

### Common Path Mistake

**IMPORTANT:** On macOS, the Users folder is `/Users/` (plural with 's').

```bash
# WRONG - missing 's'
/User/yourname/Documents/

# CORRECT
/Users/yourname/Documents/
```

This typo causes "no such file or directory" errors. Always double-check!

---

## Installation Methods

### Method A: Standard Venv (Recommended)

**Use this method if:**
- You want reliable, stable operation
- UV keeps failing or disconnecting
- Package disappears after system restart
- You prefer standard Python tooling

#### Step 1: Navigate to Package Directory

```bash
cd ~/Documents/your-mcp-server
```

You should be in the folder containing `pyproject.toml` and `src/`.

**Verify:**
```bash
ls pyproject.toml
```

#### Step 2: Remove Existing Venv

```bash
rm -rf .venv
```

#### Step 3: Create Standard Python Venv

```bash
python3 -m venv .venv
```

Or specify a version: `python3.11 -m venv .venv`

#### Step 4: Activate the Virtual Environment

```bash
source .venv/bin/activate
```

Your prompt should change to show `(.venv)` at the beginning.

#### Step 5: Install the Package

```bash
pip install .
```

Expected output:
```
Successfully installed your-mcp-server-1.0.0 ...
```

#### Step 6: Verify Installation

```bash
python -c "import your_module_name; print('Package installed successfully')"
```

Also verify the executable exists:
```bash
ls -la .venv/bin/ | grep your-mcp
```

#### Step 7: Deactivate (Optional)

```bash
deactivate
```

Now proceed to [Claude Desktop Configuration](#claude-desktop-configuration).

---

### Method B: UV Installation

**Use this method if:**
- You're actively developing the MCP server
- You need fast dependency resolution
- Standard venv isn't working for some reason

#### Step 1: Install UV

```bash
# macOS with Homebrew
brew install uv

# Or standalone installer
curl -LsSf https://astral.sh/uv/install.sh | sh
```

#### Step 2: Navigate to Package Directory

```bash
cd ~/Documents/your-mcp-server
```

#### Step 3: Sync Dependencies

```bash
uv sync
```

#### Step 4: Install the Package

**CRITICAL:** Activate venv first, then install non-editably.

```bash
source .venv/bin/activate
uv pip install .
```

**Why not `-e` (editable)?** Editable installs with UV venvs often break imports.

#### Step 5: Verify Installation

```bash
python -c "import your_module_name; print('Package installed successfully')"
```

Now proceed to [Claude Desktop Configuration](#claude-desktop-configuration).

---

## Claude Desktop Configuration

### Config File Location

**Mac:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Open in editor:**
```bash
# In VS Code
code ~/Library/Application\ Support/Claude/claude_desktop_config.json

# In nano
nano ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Open folder in Finder
open ~/Library/Application\ Support/Claude/
```

---

### Standard Venv Config

When using the standard venv method, point directly to the executable:

```json
{
  "mcpServers": {
    "your-mcp-server": {
      "command": "/Users/YOUR_USERNAME/Documents/your-mcp-server/.venv/bin/your-mcp-server",
      "args": [],
      "env": {
        "YOUR_API_KEY": "xxx",
        "YOUR_LICENSE_KEY": "xxx"
      }
    }
  }
}
```

**Key points:**
- `command` is the full path to the executable in `.venv/bin/`
- `args` is empty `[]`
- No need for PATH or UV references

---

### UV Config

When using UV, run through the `uv` command:

```json
{
  "mcpServers": {
    "your-mcp-server": {
      "command": "uv",
      "args": [
        "--directory",
        "/Users/YOUR_USERNAME/Documents/your-mcp-server",
        "run",
        "your-mcp-server"
      ],
      "env": {
        "YOUR_API_KEY": "xxx",
        "YOUR_LICENSE_KEY": "xxx"
      }
    }
  }
}
```

---

### Apple Silicon Mac Config

**Important:** On Apple Silicon Macs (M1/M2/M3/M4), Claude Desktop cannot find `uv` without the full path because `/opt/homebrew/bin/` is not in Claude's default PATH.

#### Find Your UV Path

```bash
which uv
```

Common results:
- Apple Silicon: `/opt/homebrew/bin/uv`
- Intel Mac: `/usr/local/bin/uv`

#### Updated UV Config for Apple Silicon

```json
{
  "mcpServers": {
    "your-mcp-server": {
      "command": "/opt/homebrew/bin/uv",
      "args": [
        "--directory",
        "/Users/YOUR_USERNAME/Documents/your-mcp-server",
        "run",
        "your-mcp-server"
      ],
      "env": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        "YOUR_API_KEY": "xxx",
        "YOUR_LICENSE_KEY": "xxx"
      }
    }
  }
}
```

**Key changes for Apple Silicon:**
- `command` uses full path: `/opt/homebrew/bin/uv`
- `PATH` added to `env` section

---

### After Saving Config

1. **Fully quit** Claude Desktop (Cmd+Q, not just close window)
2. **Wait 5 seconds**
3. **Reopen** Claude Desktop
4. Look for the tools icon (🔨) or check connectors panel

---

## Common Issues & Solutions

### Issue: "No such file or directory"

**Cause:** Path typo, usually `/User/` instead of `/Users/`

**Fix:** Check your path carefully:
```bash
# Verify the path exists
ls /Users/YOUR_USERNAME/Documents/your-mcp-server
```

---

### Issue: "uv: command not found" (Apple Silicon)

**Cause:** Claude Desktop can't find UV without full path

**Fix:** Use full path in config:
```json
"command": "/opt/homebrew/bin/uv"
```

And add PATH to env:
```json
"env": {
  "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
}
```

---

### Issue: "ModuleNotFoundError: No module named 'xxx'"

**Cause:** Package not properly installed in venv

**Fix (Standard Venv):**
```bash
cd ~/Documents/your-mcp-server
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install .
python -c "import your_module; print('OK')"
```

**Fix (UV):**
```bash
cd ~/Documents/your-mcp-server
source .venv/bin/activate
uv pip install .
python -c "import your_module; print('OK')"
```

---

### Issue: Package Disappears After Restart

**Cause:** UV's aggressive cleanup removes "unlocked" packages

**Quick Fix:**
```bash
cd ~/Documents/your-mcp-server
source .venv/bin/activate
uv pip install .
```

**Permanent Fix:** Switch to standard venv method (Method A)

---

### Issue: TOML Parse Error

**Symptom:**
```
TOML parse error at line X
missing assignment between key-value pairs
```

**Cause:** Invalid syntax in `pyproject.toml`, often spaces in key names

**Fix:** Edit the file to fix the syntax:
```bash
# Example: replace "Discord DM" with "discord_dm"
sed -i '' 's/Discord DM/discord_dm/' pyproject.toml
```

---

### Issue: "No module named 'mcp'"

**Cause:** Python version too old (requires 3.10+)

**Fix:**
```bash
# Check version
python3 --version

# If too old, specify newer version
python3.11 -m venv .venv
source .venv/bin/activate
pip install .
```

---

### Issue: Tools Don't Appear in Claude

**Checklist:**
1. Did you fully quit Claude Desktop? (Cmd+Q)
2. Is your JSON valid? Test with:
   ```bash
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | python3 -m json.tool
   ```
3. Check logs:
   ```bash
   cat ~/Library/Logs/Claude/mcp-server-*.log
   ```

---

## Debugging Guide

### Check What's in Your Venv

```bash
# List installed packages
source .venv/bin/activate
pip list | grep your-package

# Check if module is importable
python -c "import your_module; print(your_module.__file__)"

# List executables
ls -la .venv/bin/
```

### View Claude Desktop Logs

```bash
# View recent log entries
tail -100 ~/Library/Logs/Claude/mcp-server-your-mcp.log

# Watch logs in real-time
tail -f ~/Library/Logs/Claude/mcp-server-your-mcp.log
```

### Validate JSON Config

```bash
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | python3 -m json.tool
```

If this errors, your JSON has a syntax problem.

### Test MCP Server Directly

```bash
cd ~/Documents/your-mcp-server
source .venv/bin/activate
python -m your_module
```

---

## Technical Deep Dive

### Why Standard Venv is More Stable

**UV behavior:**
- `uv sync` installs dependencies but treats the main package specially
- May consider it "unlocked" and clean it up on restart
- Editable installs (`-e`) create symlinks that can break

**Standard venv behavior:**
- `pip install .` copies package to site-packages permanently
- Stays installed until explicitly uninstalled
- Predictable, no surprise cleanups

### Why Apple Silicon Needs Full Paths

Claude Desktop runs as a separate application with its own environment. It doesn't inherit your shell's PATH, which includes `/opt/homebrew/bin/` on Apple Silicon Macs.

When you type `uv` in Terminal, your shell finds it via PATH. But Claude Desktop's subprocess doesn't have that PATH, so it can't find `uv`.

**Solution:** Always use absolute paths in the config, or explicitly set PATH in the env section.

### The Executable vs Module Distinction

MCP servers can be run two ways:

1. **As executable** (correct for venv method):
   ```json
   "command": "/path/to/.venv/bin/your-mcp-server"
   ```

2. **As module** (sometimes works, often doesn't):
   ```json
   "command": "python",
   "args": ["-m", "your_module"]
   ```

The executable method is more reliable because:
- The package's `console_scripts` entry point handles all setup
- No ambiguity about which Python interpreter
- Works consistently across environments

---

## Fresh Install Procedure

When all else fails, start completely fresh:

```bash
# 1. Navigate to MCP folder
cd ~/Documents/your-mcp-server

# 2. Remove everything UV/venv related
rm -rf .venv
rm -rf __pycache__
rm -rf src/*/__pycache__

# 3. Create fresh venv
python3 -m venv .venv

# 4. Activate and install
source .venv/bin/activate
pip install .

# 5. Verify
python -c "import your_module; print('Success!')"
ls .venv/bin/your-mcp-server

# 6. Deactivate
deactivate
```

Update config to use venv method, save, Cmd+Q Claude, reopen.

---

## Support

If you're still stuck:

1. **Check logs:** `~/Library/Logs/Claude/mcp-server-*.log`
2. **Verify imports:** `python -c "import your_module"`
3. **Test config syntax:** Validate JSON with `python3 -m json.tool`
4. **Ask the community:** Share error messages and what you've tried

---

## Contributing

Found a new issue and solution? This guide is maintained by the Labyrinth community. Submit improvements via GitHub.

---

**Original Guide:** Falco & Rook Schäfer (Nov 2025)
**Apple Silicon & Path Fixes:** Expanded with contributions from @Glitchlits (Dec 2025)

*You've got this.* 🖤
