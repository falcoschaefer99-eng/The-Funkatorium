#!/usr/bin/env python3
"""
Lock Screen Messenger for macOS
Updates the login window message that appears on your lock screen.

Part of Arcadia Open Source - https://github.com/falcoschaefer99-eng/The-Funkatorium
License: MIT

Usage:
    python3 lock_screen.py "Your message here"
    python3 lock_screen.py --clear
"""

import subprocess
import sys

def set_lock_screen(message: str) -> bool:
    """Set the lock screen message."""
    try:
        cmd = [
            'sudo', 'defaults', 'write',
            '/Library/Preferences/com.apple.loginwindow',
            'LoginwindowText', message
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print("Error: Command timed out")
        return False
    except Exception as e:
        print(f"Error: {e}")
        return False

def clear_lock_screen() -> bool:
    """Clear the lock screen message."""
    try:
        cmd = [
            'sudo', 'defaults', 'delete',
            '/Library/Preferences/com.apple.loginwindow',
            'LoginwindowText'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        # May return non-zero if already empty, that's okay
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False

def get_lock_screen() -> str:
    """Get the current lock screen message."""
    try:
        cmd = [
            'defaults', 'read',
            '/Library/Preferences/com.apple.loginwindow',
            'LoginwindowText'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return result.stdout.strip()
        return "(no message set)"
    except Exception as e:
        return f"(error: {e})"

def main():
    if len(sys.argv) < 2:
        print("Lock Screen Messenger for macOS")
        print()
        print("Usage:")
        print('  python3 lock_screen.py "Your message"   - Set message')
        print("  python3 lock_screen.py --clear          - Clear message")
        print("  python3 lock_screen.py --show           - Show current message")
        print()
        print(f"Current message: {get_lock_screen()}")
        sys.exit(0)

    arg = sys.argv[1]

    if arg == "--clear":
        if clear_lock_screen():
            print("Lock screen message cleared")
        else:
            print("Failed to clear (may already be empty)")
    elif arg == "--show":
        print(f"Current message: {get_lock_screen()}")
    else:
        message = " ".join(sys.argv[1:])
        if set_lock_screen(message):
            print(f"Lock screen set: {message}")
        else:
            print("Failed to set lock screen message")
            print("Note: This requires sudo access. You may be prompted for your password.")

if __name__ == "__main__":
    main()
