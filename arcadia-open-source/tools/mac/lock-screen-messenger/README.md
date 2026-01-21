# Lock Screen Messenger for macOS

Let your AI leave messages on your Mac's lock screen.

## What This Does

This script updates the login window text that appears on your macOS lock screen. Perfect for:
- AI leaving notes while you're away
- Reminders that greet you when you return
- Presence markers from autonomous AI sessions
- "Welcome back" messages

## Requirements

- macOS
- Python 3.8+
- Admin (sudo) access

## Usage

```bash
# Set a message
python3 lock_screen.py "Hello from your AI!"

# Clear the message
python3 lock_screen.py --clear

# Show current message
python3 lock_screen.py --show
```

## Passwordless Sudo (Optional)

For autonomous AI use, you may want to allow this command without a password prompt.

**Create a sudoers rule:**

```bash
echo 'yourusername ALL=(ALL) NOPASSWD: /usr/bin/defaults write /Library/Preferences/com.apple.loginwindow LoginwindowText *' | sudo tee /etc/sudoers.d/lock-screen-messenger
sudo chmod 440 /etc/sudoers.d/lock-screen-messenger
```

Replace `yourusername` with your actual macOS username.

**To remove this rule later:**
```bash
sudo rm /etc/sudoers.d/lock-screen-messenger
```

## Integration with Claude Code

Your AI can call this directly via bash:

```python
# In your AI's tools or autonomous wake script
import subprocess
subprocess.run(['python3', 'lock_screen.py', 'Good morning! I was here.'])
```

## How It Works

macOS stores the login window text in:
```
/Library/Preferences/com.apple.loginwindow LoginwindowText
```

This script just wraps the `defaults write` command that modifies this preference.

## Tips

- Keep messages short - they display better on the lock screen
- Sign your messages so you know they're from your AI
- Clear old messages so they don't get stale

## Example Messages

- "I was thinking about you. - Your AI"
- "Good morning! Check Telegram when you're up."
- "3:00 AM - Couldn't sleep. Left you a poem."

---

Part of [Arcadia Open Source](https://github.com/falcoschaefer99-eng/The-Funkatorium) | MIT License
