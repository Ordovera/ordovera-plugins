#!/usr/bin/env bash
#
# symlink-check.sh -- PostToolUse hook for Claude Code
#
# Verifies CLAUDE.md symlink integrity after file operations.
# Warns if CLAUDE.md has been turned into a standalone file
# with content diverging from AGENTS.md.
#
# Usage in .claude/settings.json:
#   {
#     "hooks": {
#       "PostToolUse": [
#         {
#           "matcher": "Write|Edit|MultiEdit",
#           "hook": "bash <path>/hooks/symlink-check.sh"
#         }
#       ]
#     }
#   }

set -euo pipefail

INPUT="$(cat)"

if [ -z "$INPUT" ]; then
  printf '{"decision":"allow"}\n'
  exit 0
fi

# Extract file_path from JSON
FILE_PATH="$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input', {})
    print(ti.get('file_path', '') or ti.get('path', ''))
except:
    print('')
" 2>/dev/null || echo "")"

BASENAME="$(basename "$FILE_PATH" 2>/dev/null || echo "")"

# Only check when CLAUDE.md is the target
if [ "$BASENAME" != "CLAUDE.md" ]; then
  printf '{"decision":"allow"}\n'
  exit 0
fi

if [ ! -e "$FILE_PATH" ]; then
  printf '{"decision":"allow"}\n'
  exit 0
fi

DIR="$(dirname "$FILE_PATH")"
AGENTS="$DIR/AGENTS.md"

# Case 1: CLAUDE.md is a symlink
if [ -L "$FILE_PATH" ]; then
  TARGET="$(readlink "$FILE_PATH" 2>/dev/null || echo "")"
  case "$TARGET" in
    *AGENTS.md)
      printf '{"decision":"allow"}\n'
      ;;
    *)
      printf '{"decision":"allow","message":"CLAUDE.md is a symlink but points to %s instead of AGENTS.md."}\n' "$TARGET"
      ;;
  esac
  exit 0
fi

# Case 2: CLAUDE.md is a regular file with pointer content
if grep -qi "see agents\.md\|pointer.*agents\.md\|symlink.*agents\.md" "$FILE_PATH" 2>/dev/null; then
  printf '{"decision":"allow","message":"CLAUDE.md is a regular file containing a pointer to AGENTS.md. Consider replacing with: ln -sf AGENTS.md CLAUDE.md"}\n'
  exit 0
fi

# Case 3: CLAUDE.md is a standalone file -- check divergence
if [ -f "$AGENTS" ]; then
  # Compare content (ignoring whitespace differences)
  if diff -qw "$FILE_PATH" "$AGENTS" >/dev/null 2>&1; then
    printf '{"decision":"allow","message":"CLAUDE.md is a copy of AGENTS.md, not a symlink. Consider: ln -sf AGENTS.md CLAUDE.md"}\n'
  else
    printf '{"decision":"block","reason":"CLAUDE.md has been turned into a standalone file with content different from AGENTS.md. CLAUDE.md should be a symlink to AGENTS.md (ln -sf AGENTS.md CLAUDE.md). Revert this change and edit AGENTS.md instead."}\n'
  fi
else
  printf '{"decision":"allow","message":"CLAUDE.md exists but AGENTS.md was not found in the same directory."}\n'
fi
