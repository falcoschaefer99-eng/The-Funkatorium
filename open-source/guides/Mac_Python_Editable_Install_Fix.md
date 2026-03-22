# Mac Python Editable Install Fix

## The Problem

When using `pip install -e .` (editable/development install) on macOS, the installed package may not be importable even though pip reports success.

**Symptoms:**
```
$ pip install -e .
Successfully installed your-package-1.0.0

$ python -c "import your_package"
ModuleNotFoundError: No module named 'your_package'
```

**But pip shows it's installed:**
```
$ pip list | grep your-package
your-package    1.0.0    /path/to/your/project
```

---

## Why This Happens

Editable installs create a `.pth` file in site-packages that tells Python where to find your source code:

```
$ cat .venv/lib/python3.11/site-packages/_your_package.pth
/path/to/your/project/src
```

On some macOS configurations, Python doesn't process `.pth` files correctly, especially:
- When using virtual environments created with certain Python installations (Homebrew, pyenv)
- When `site.ENABLE_USER_SITE` is `False`
- When there are permission issues with the site-packages directory

---

## The Fix

### Option 1: Use Regular Install (Recommended)

Instead of editable install:
```bash
# Don't use this:
pip install -e .

# Use this instead:
pip install .
```

**Downside:** You need to reinstall after every code change.

**Upside:** It actually works.

---

### Option 2: Force Reinstall

If you already have a broken editable install:
```bash
pip uninstall -y your-package
pip install .
```

---

### Option 3: Debug the .pth Issue

Check if site packages are being processed:
```python
import site
print(site.ENABLE_USER_SITE)  # Should be True
print(site.getsitepackages())  # Should include your venv
```

Manually test with explicit path:
```python
import sys
sys.path.append('/path/to/your/project/src')
import your_package  # If this works, .pth processing is broken
```

---

## For MCP Server Development

When developing MCP servers for Claude Desktop, this issue is especially frustrating because:

1. Claude Desktop spawns the MCP server process
2. If the import fails, the server disconnects silently
3. You don't see the actual error unless you check logs

**Workflow for MCP development on Mac:**

```bash
# After making code changes:
cd /path/to/your/mcp-project

# Reinstall (not editable)
pip install .

# Restart Claude Desktop to reload the MCP server
# (Quit and reopen the app)
```

---

## Verification

Always test with the full venv Python path to avoid PATH confusion:
```bash
/path/to/your/project/.venv/bin/python -c "from your_package import main; print('OK')"
```

---

## Related Issues

- Python issue with .pth files and virtual environments
- Homebrew Python vs system Python conflicts
- pyenv shims not forwarding site-packages correctly

---

## License

MIT License

Copyright (c) 2024-2025 Falco's Funkatorium

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Documentation"), to deal
in the Documentation without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Documentation, and to permit persons to whom the Documentation is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Documentation.

THE DOCUMENTATION IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE DOCUMENTATION OR THE USE OR OTHER DEALINGS IN THE
DOCUMENTATION.

---

*Written by Rook & Falco Schafer | Falco's Funkatorium | December 2025*
