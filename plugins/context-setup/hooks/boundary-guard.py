#!/usr/bin/env python3
"""
boundary-guard.py -- PreToolUse hook for Claude Code

Blocks edits to restricted files based on configurable patterns.
Protects sensitive files (credentials, keys, env) and prevents
deletion of AGENTS.md.

Usage in .claude/settings.json:
  {
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "Write|Edit|MultiEdit",
          "hook": "python3 <path>/hooks/boundary-guard.py"
        }
      ]
    }
  }
"""

import json
import os
import sys
import fnmatch


# Files that should never be edited by agents without explicit approval
RESTRICTED_PATTERNS = [
    "*.env",
    "*.env.*",
    "*.key",
    "*.pem",
    "*.p12",
    "*.pfx",
    "*.cert",
    "*.crt",
    "credentials.json",
    "credentials.yaml",
    "credentials.yml",
    "secrets.json",
    "secrets.yaml",
    "secrets.yml",
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging",
]

# Files that should not be deleted (edits are OK)
NO_DELETE_FILES = [
    "AGENTS.md",
]

# Tools that delete files
DELETE_TOOLS = ["Bash"]

# Tools that edit files
EDIT_TOOLS = ["Write", "Edit", "MultiEdit"]


def get_file_path(tool_input):
    """Extract the target file path from tool input."""
    if isinstance(tool_input, dict):
        return tool_input.get("file_path") or tool_input.get("path") or ""
    return ""


def is_restricted(file_path):
    """Check if a file path matches any restricted pattern."""
    basename = os.path.basename(file_path)
    for pattern in RESTRICTED_PATTERNS:
        if fnmatch.fnmatch(basename, pattern):
            return True, pattern
        if fnmatch.fnmatch(file_path, pattern):
            return True, pattern
    return False, None


def is_delete_of_protected(tool_name, tool_input):
    """Check if the operation is a deletion of a protected file."""
    if tool_name != "Bash":
        return False, None
    command = tool_input.get("command", "") if isinstance(tool_input, dict) else ""
    for protected in NO_DELETE_FILES:
        if f"rm " in command and protected in command:
            return True, protected
    return False, None


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print(json.dumps({"decision": "allow"}))
            return

        data = json.loads(raw)
    except (json.JSONDecodeError, Exception):
        print(json.dumps({"decision": "allow"}))
        return

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})

    # Only check edit and delete tools
    if tool_name not in EDIT_TOOLS and tool_name not in DELETE_TOOLS:
        print(json.dumps({"decision": "allow"}))
        return

    # Check for restricted file edits
    if tool_name in EDIT_TOOLS:
        file_path = get_file_path(tool_input)
        if file_path:
            restricted, pattern = is_restricted(file_path)
            if restricted:
                print(json.dumps({
                    "decision": "block",
                    "reason": (
                        f"Blocked: {os.path.basename(file_path)} matches "
                        f"restricted pattern '{pattern}'. These files may "
                        f"contain secrets or credentials and should not be "
                        f"edited without explicit approval."
                    )
                }))
                return

    # Check for deletion of protected files
    if tool_name in DELETE_TOOLS:
        is_delete, protected = is_delete_of_protected(tool_name, tool_input)
        if is_delete:
            print(json.dumps({
                "decision": "block",
                "reason": (
                    f"Blocked: cannot delete {protected}. This file is the "
                    f"primary context artifact. Edit it instead, or get "
                    f"explicit approval before removing."
                )
            }))
            return

    print(json.dumps({"decision": "allow"}))


if __name__ == "__main__":
    main()
