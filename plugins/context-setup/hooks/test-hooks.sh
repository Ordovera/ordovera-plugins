#!/usr/bin/env bash
#
# test-hooks.sh -- Test suite for context-setup hooks
#
# Runs each hook with controlled inputs and verifies
# allow/block decisions.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
TMPDIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

assert_decision() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"

  local decision
  decision="$(printf '%s' "$actual" | python3 -c "
import json, sys
try:
    print(json.load(sys.stdin).get('decision', 'unknown'))
except:
    print('parse_error')
" 2>/dev/null || echo "parse_error")"

  if [ "$decision" = "$expected" ]; then
    printf "  PASS: %s\n" "$test_name"
    PASS=$((PASS + 1))
  else
    printf "  FAIL: %s (expected %s, got %s)\n" "$test_name" "$expected" "$decision"
    printf "        output: %s\n" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

# ============================================================
# boundary-guard.py tests
# ============================================================
printf "boundary-guard.py\n"

# Test: allow normal file edit
RESULT="$(printf '{"tool_name":"Write","tool_input":{"file_path":"src/index.ts"}}' | python3 "$SCRIPT_DIR/boundary-guard.py")"
assert_decision "allows normal file edit" "allow" "$RESULT"

# Test: block .env edit
RESULT="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"/project/.env"}}' | python3 "$SCRIPT_DIR/boundary-guard.py")"
assert_decision "blocks .env edit" "block" "$RESULT"

# Test: block .env.local edit
RESULT="$(printf '{"tool_name":"Write","tool_input":{"file_path":"config/.env.local"}}' | python3 "$SCRIPT_DIR/boundary-guard.py")"
assert_decision "blocks .env.local edit" "block" "$RESULT"

# Test: block credentials.json edit
RESULT="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"credentials.json"}}' | python3 "$SCRIPT_DIR/boundary-guard.py")"
assert_decision "blocks credentials.json edit" "block" "$RESULT"

# Test: block .pem file edit
RESULT="$(printf '{"tool_name":"Write","tool_input":{"file_path":"certs/server.pem"}}' | python3 "$SCRIPT_DIR/boundary-guard.py")"
assert_decision "blocks .pem file edit" "block" "$RESULT"

# Test: allow AGENTS.md edit
RESULT="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"AGENTS.md"}}' | python3 "$SCRIPT_DIR/boundary-guard.py")"
assert_decision "allows AGENTS.md edit" "allow" "$RESULT"

# Test: block AGENTS.md deletion via rm
RESULT="$(printf '{"tool_name":"Bash","tool_input":{"command":"rm AGENTS.md"}}' | python3 "$SCRIPT_DIR/boundary-guard.py")"
assert_decision "blocks AGENTS.md deletion" "block" "$RESULT"

# Test: allow non-edit tools
RESULT="$(printf '{"tool_name":"Read","tool_input":{"file_path":".env"}}' | python3 "$SCRIPT_DIR/boundary-guard.py")"
assert_decision "allows Read tool on restricted file" "allow" "$RESULT"

# Test: handle empty input
RESULT="$(printf '' | python3 "$SCRIPT_DIR/boundary-guard.py")"
assert_decision "handles empty input" "allow" "$RESULT"

printf "\n"

# ============================================================
# lint-context.sh tests
# ============================================================
printf "lint-context.sh\n"

# Create test files
printf "# Good File\n\nContent here.\n" > "$TMPDIR/AGENTS.md"
printf "No heading here\n" > "$TMPDIR/bad-heading.md"
printf "# Trailing  \n\nContent.\n" > "$TMPDIR/trailing.md"

# Test: allows well-formed context file
RESULT="$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/AGENTS.md"}}' "$TMPDIR" | bash "$SCRIPT_DIR/lint-context.sh")"
assert_decision "allows well-formed AGENTS.md" "allow" "$RESULT"

# Test: allows non-context file (skips check)
RESULT="$(printf '{"tool_name":"Write","tool_input":{"file_path":"src/index.ts"}}' | bash "$SCRIPT_DIR/lint-context.sh")"
assert_decision "skips non-context file" "allow" "$RESULT"

# Test: allows non-edit tools
RESULT="$(printf '{"tool_name":"Read","tool_input":{"file_path":"%s/AGENTS.md"}}' "$TMPDIR" | bash "$SCRIPT_DIR/lint-context.sh")"
assert_decision "skips Read tool" "allow" "$RESULT"

# Test: handles empty input
RESULT="$(printf '' | bash "$SCRIPT_DIR/lint-context.sh")"
assert_decision "handles empty input" "allow" "$RESULT"

printf "\n"

# ============================================================
# symlink-check.sh tests
# ============================================================
printf "symlink-check.sh\n"

# Create test scenarios
printf "# AGENTS.md\n\nPrimary file.\n" > "$TMPDIR/AGENTS.md"
ln -sf AGENTS.md "$TMPDIR/CLAUDE-symlink.md"
printf "See AGENTS.md for all context.\n" > "$TMPDIR/CLAUDE-pointer.md"
printf "# Different Content\n\nThis diverges from AGENTS.md.\n" > "$TMPDIR/CLAUDE-diverged.md"
cp "$TMPDIR/AGENTS.md" "$TMPDIR/CLAUDE-copy.md"

# Test: allows symlink to AGENTS.md
RESULT="$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/CLAUDE-symlink.md"}}' "$TMPDIR" | BASENAME_OVERRIDE=CLAUDE.md bash "$SCRIPT_DIR/symlink-check.sh")"
# symlink-check only triggers on CLAUDE.md basename, so this skips
assert_decision "skips non-CLAUDE.md file" "allow" "$RESULT"

# Rename to actual CLAUDE.md for proper tests
ln -sf AGENTS.md "$TMPDIR/CLAUDE.md"
RESULT="$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/CLAUDE.md"}}' "$TMPDIR" | bash "$SCRIPT_DIR/symlink-check.sh")"
assert_decision "allows CLAUDE.md symlink to AGENTS.md" "allow" "$RESULT"

# Test: pointer file
rm "$TMPDIR/CLAUDE.md"
printf "See AGENTS.md for all context.\n" > "$TMPDIR/CLAUDE.md"
RESULT="$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/CLAUDE.md"}}' "$TMPDIR" | bash "$SCRIPT_DIR/symlink-check.sh")"
assert_decision "warns on pointer file (allow)" "allow" "$RESULT"

# Test: diverged file
rm "$TMPDIR/CLAUDE.md"
printf "# Different Content\n\nThis diverges.\n" > "$TMPDIR/CLAUDE.md"
RESULT="$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/CLAUDE.md"}}' "$TMPDIR" | bash "$SCRIPT_DIR/symlink-check.sh")"
assert_decision "blocks diverged CLAUDE.md" "block" "$RESULT"

# Test: skips non-CLAUDE.md
RESULT="$(printf '{"tool_name":"Write","tool_input":{"file_path":"src/index.ts"}}' | bash "$SCRIPT_DIR/symlink-check.sh")"
assert_decision "skips non-CLAUDE.md file" "allow" "$RESULT"

printf "\n"

# ============================================================
# Summary
# ============================================================
TOTAL=$((PASS + FAIL))
printf "Results: %d/%d passed\n" "$PASS" "$TOTAL"

if [ "$FAIL" -gt 0 ]; then
  printf "FAILED: %d test(s)\n" "$FAIL"
  exit 1
else
  printf "All tests passed.\n"
  exit 0
fi
