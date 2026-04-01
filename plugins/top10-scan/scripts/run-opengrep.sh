#!/usr/bin/env bash
set -euo pipefail

# run-opengrep.sh -- SAST scanning via opengrep
# Usage: run-opengrep.sh <target_dir> <language> [<extra_rules>]
# Output: JSON to stdout, errors to stderr

TARGET_DIR="${1:-}"
LANGUAGE="${2:-}"
EXTRA_RULES="${3:-}"

if [[ -z "$TARGET_DIR" || -z "$LANGUAGE" ]]; then
  echo '{"error": "invalid_args", "tool": "opengrep", "message": "Usage: run-opengrep.sh <target_dir> <language> [<extra_rules>]"}' >&2
  exit 1
fi

# Graceful degradation: check for opengrep
if ! which opengrep >/dev/null 2>&1; then
  echo '{"error": "tool_not_installed", "tool": "opengrep", "message": "opengrep is not installed. Install from https://github.com/opengrep/opengrep"}'
  exit 0
fi

# Create temp dir for output
TMPDIR_OUT="$(mktemp -d)"
SARIF_FILE="${TMPDIR_OUT}/opengrep-results.sarif"

# Cleanup on unexpected exit
cleanup() {
  local exit_code=$?
  if [[ $exit_code -ne 0 && -z "${HANDLED_ERROR:-}" ]]; then
    echo "{\"error\": \"scan_failed\", \"tool\": \"opengrep\", \"message\": \"Unexpected error (exit $exit_code)\", \"exit_code\": $exit_code}"
    exit 0
  fi
}
trap cleanup EXIT

# Map language to rule path
declare -A LANG_MAP=(
  [javascript]="javascript"
  [typescript]="typescript"
  [python]="python"
  [java]="java"
  [go]="go"
  [ruby]="ruby"
  [php]="php"
)

RULE_LANG="${LANG_MAP[$LANGUAGE]:-}"
if [[ -z "$RULE_LANG" ]]; then
  HANDLED_ERROR=1
  echo "{\"error\": \"unsupported_language\", \"tool\": \"opengrep\", \"message\": \"Unsupported language: $LANGUAGE. Supported: javascript, typescript, python, java, go, ruby, php\"}"
  exit 0
fi

# Build rule paths
RULE_PATHS=()
RULES_USED=()

RULE_PATHS+=("--config" "auto")
RULES_USED+=("\"auto:${RULE_LANG}\"")

# Add extra rules if provided
if [[ -n "$EXTRA_RULES" ]]; then
  IFS=',' read -ra EXTRA_RULE_LIST <<< "$EXTRA_RULES"
  for rule in "${EXTRA_RULE_LIST[@]}"; do
    rule="$(echo "$rule" | xargs)"  # trim whitespace
    RULE_PATHS+=("--config" "$rule")
    RULES_USED+=("\"${rule}\"")
  done
fi

# Build rules_used JSON array
RULES_JSON="[$(IFS=,; echo "${RULES_USED[*]}")]"

# Run opengrep scan
SCAN_EXIT=0
opengrep scan "${RULE_PATHS[@]}" --sarif-output "$SARIF_FILE" "$TARGET_DIR" >/dev/null 2>&1 || SCAN_EXIT=$?

# opengrep exit codes: 0 = no findings, 1 = findings found, other = error
if [[ $SCAN_EXIT -le 1 ]]; then
  HANDLED_ERROR=1
  echo "{\"sarif_path\": \"${SARIF_FILE}\", \"rules_used\": ${RULES_JSON}, \"language\": \"${LANGUAGE}\", \"exit_code\": 0}"
  exit 0
else
  HANDLED_ERROR=1
  echo "{\"error\": \"scan_failed\", \"tool\": \"opengrep\", \"message\": \"opengrep exited with code ${SCAN_EXIT}\", \"exit_code\": ${SCAN_EXIT}}"
  exit 0
fi
