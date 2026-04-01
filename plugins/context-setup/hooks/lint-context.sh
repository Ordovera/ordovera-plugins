#!/usr/bin/env bash
#
# lint-context.sh -- PostToolUse hook for Claude Code
#
# Validates context file formatting after edits to AGENTS.md,
# CLAUDE.md, or context/*.md files.
#
# Usage in .claude/settings.json:
#   {
#     "hooks": {
#       "PostToolUse": [
#         {
#           "matcher": "Write|Edit|MultiEdit",
#           "hook": "bash <path>/hooks/lint-context.sh"
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

# Extract file_path from JSON using Python (reliable, stdlib)
FILE_PATH="$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input', {})
    print(ti.get('file_path', '') or ti.get('path', ''))
except:
    print('')
" 2>/dev/null || echo "")"

TOOL_NAME="$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_name', ''))
except:
    print('')
" 2>/dev/null || echo "")"

# Only act on Write/Edit tools
case "$TOOL_NAME" in
  Write|Edit|MultiEdit) ;;
  *)
    printf '{"decision":"allow"}\n'
    exit 0
    ;;
esac

# Only check context files
BASENAME="$(basename "$FILE_PATH" 2>/dev/null || echo "")"
IS_CONTEXT=false

case "$BASENAME" in
  AGENTS.md|CLAUDE.md) IS_CONTEXT=true ;;
esac
case "$FILE_PATH" in
  */context/*.md) IS_CONTEXT=true ;;
esac

if [ "$IS_CONTEXT" = false ]; then
  printf '{"decision":"allow"}\n'
  exit 0
fi

if [ ! -f "$FILE_PATH" ]; then
  printf '{"decision":"allow"}\n'
  exit 0
fi

# Resolve symlinks for content checks
REAL_PATH="$FILE_PATH"
if [ -L "$FILE_PATH" ]; then
  REAL_PATH="$(readlink -f "$FILE_PATH" 2>/dev/null || readlink "$FILE_PATH")"
  if [ ! -f "$REAL_PATH" ]; then
    printf '{"decision":"allow"}\n'
    exit 0
  fi
fi

WARNINGS=""

# 1. File should start with a heading
FIRST_LINE="$(head -1 "$REAL_PATH")"
case "$FIRST_LINE" in
  \#*) ;;
  "") WARNINGS="${WARNINGS}File starts with a blank line instead of a heading. " ;;
  *) WARNINGS="${WARNINGS}File does not start with a markdown heading. " ;;
esac

# 2. Trailing whitespace
TRAILING="$(grep -cP '\s+$' "$REAL_PATH" 2>/dev/null || echo 0)"
if [ "$TRAILING" -gt 0 ] 2>/dev/null; then
  WARNINGS="${WARNINGS}Found ${TRAILING} line(s) with trailing whitespace. "
fi

# 3. File should end with newline
if [ -s "$REAL_PATH" ]; then
  LAST="$(tail -c 1 "$REAL_PATH" | od -An -tx1 | tr -d ' ')"
  if [ "$LAST" != "0a" ] && [ -n "$LAST" ]; then
    WARNINGS="${WARNINGS}File does not end with a newline. "
  fi
fi

# 4. CLAUDE.md symlink check
if [ "$BASENAME" = "CLAUDE.md" ]; then
  if [ -L "$FILE_PATH" ]; then
    TARGET="$(readlink "$FILE_PATH" 2>/dev/null || echo "")"
    case "$TARGET" in
      *AGENTS.md) ;;
      *) WARNINGS="${WARNINGS}CLAUDE.md symlink does not point to AGENTS.md (points to: ${TARGET}). " ;;
    esac
  elif grep -qi "see agents\.md\|symlink.*agents\.md" "$FILE_PATH" 2>/dev/null; then
    WARNINGS="${WARNINGS}CLAUDE.md is not a symlink but contains a pointer. Consider: ln -sf AGENTS.md CLAUDE.md. "
  else
    WARNINGS="${WARNINGS}CLAUDE.md is not a symlink to AGENTS.md. Recommended: ln -sf AGENTS.md CLAUDE.md. "
  fi
fi

if [ -n "$WARNINGS" ]; then
  ESCAPED="$(printf '%s' "$WARNINGS" | sed 's/"/\\"/g')"
  printf '{"decision":"allow","message":"Lint warnings: %s"}\n' "$ESCAPED"
else
  printf '{"decision":"allow"}\n'
fi
