#!/usr/bin/env bash
set -euo pipefail

# run-zap.sh -- DAST scanning via OWASP ZAP
# Usage: run-zap.sh <target_url> <scan_type> [<framework>]
# Output: JSON to stdout, errors to stderr

TARGET_URL="${1:-}"
SCAN_TYPE="${2:-}"
FRAMEWORK="${3:-}"

if [[ -z "$TARGET_URL" || -z "$SCAN_TYPE" ]]; then
  echo '{"error": "invalid_args", "tool": "zap", "message": "Usage: run-zap.sh <target_url> <scan_type> [<framework>]"}' >&2
  exit 1
fi

if [[ "$SCAN_TYPE" != "baseline" && "$SCAN_TYPE" != "full" ]]; then
  echo '{"error": "invalid_args", "tool": "zap", "message": "scan_type must be \"baseline\" or \"full\""}' >&2
  exit 1
fi

# Cleanup on unexpected exit
cleanup() {
  local exit_code=$?
  if [[ $exit_code -ne 0 && -z "${HANDLED_ERROR:-}" ]]; then
    echo "{\"error\": \"scan_failed\", \"tool\": \"zap\", \"message\": \"Unexpected error (exit $exit_code)\", \"exit_code\": $exit_code}"
    exit 0
  fi
}
trap cleanup EXIT

# Detect ZAP installation
ZAP_MODE=""

# Check Docker first
if which docker >/dev/null 2>&1; then
  if docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -q "zaproxy/zap-stable"; then
    ZAP_MODE="docker"
  fi
fi

# Fallback to local CLI
if [[ -z "$ZAP_MODE" ]]; then
  if which zap-cli >/dev/null 2>&1; then
    ZAP_MODE="zap-cli"
  elif which zap.sh >/dev/null 2>&1; then
    ZAP_MODE="zap-sh"
  fi
fi

# Graceful degradation if ZAP not found
if [[ -z "$ZAP_MODE" ]]; then
  HANDLED_ERROR=1
  echo '{"error": "tool_not_installed", "tool": "zap", "message": "OWASP ZAP not found. Install via Docker (docker pull zaproxy/zap-stable) or from https://www.zaproxy.org/download/"}'
  exit 0
fi

# Create temp dir for output
TMPDIR_OUT="$(mktemp -d)"

# Build extra ZAP options for SPA/framework support
ZAP_EXTRA_OPTS=""
if [[ "$FRAMEWORK" == "nextjs" || "$FRAMEWORK" == "react" || "$FRAMEWORK" == "angular" || "$FRAMEWORK" == "vue" ]]; then
  ZAP_EXTRA_OPTS='-z "-config spider.maxDuration=5"'
fi

# Determine scan script
if [[ "$SCAN_TYPE" == "baseline" ]]; then
  ZAP_SCRIPT="zap-baseline.py"
else
  ZAP_SCRIPT="zap-full-scan.py"
fi

ZAP_EXIT=0

if [[ "$ZAP_MODE" == "docker" ]]; then
  # Rewrite localhost/127.0.0.1 for Docker networking
  DOCKER_TARGET="$TARGET_URL"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    DOCKER_TARGET="${DOCKER_TARGET//localhost/host.docker.internal}"
    DOCKER_TARGET="${DOCKER_TARGET//127.0.0.1/host.docker.internal}"
  fi
  if [[ "$DOCKER_TARGET" != "$TARGET_URL" ]]; then
    echo "Rewriting URL for Docker networking: ${TARGET_URL} -> ${DOCKER_TARGET}" >&2
  fi

  # Docker-based ZAP scan
  DOCKER_CMD="docker run --rm -v ${TMPDIR_OUT}:/zap/wrk zaproxy/zap-stable ${ZAP_SCRIPT} -t ${DOCKER_TARGET} -J report.json"

  if [[ -n "$ZAP_EXTRA_OPTS" ]]; then
    DOCKER_CMD="docker run --rm -v ${TMPDIR_OUT}:/zap/wrk zaproxy/zap-stable ${ZAP_SCRIPT} -t ${DOCKER_TARGET} -J report.json -z \"-config spider.maxDuration=5\""
  fi

  eval "$DOCKER_CMD" >/dev/null 2>&1 || ZAP_EXIT=$?

elif [[ "$ZAP_MODE" == "zap-cli" ]]; then
  # zap-cli based scan
  if [[ "$SCAN_TYPE" == "baseline" ]]; then
    zap-cli quick-scan --spider -r "$TARGET_URL" > "${TMPDIR_OUT}/report.json" 2>/dev/null || ZAP_EXIT=$?
  else
    zap-cli active-scan "$TARGET_URL" > "${TMPDIR_OUT}/report.json" 2>/dev/null || ZAP_EXIT=$?
  fi

elif [[ "$ZAP_MODE" == "zap-sh" ]]; then
  # Direct zap.sh invocation
  ZAP_DIR="$(dirname "$(which zap.sh)")"
  if [[ -n "$ZAP_EXTRA_OPTS" ]]; then
    "${ZAP_DIR}/${ZAP_SCRIPT}" -t "$TARGET_URL" -J "${TMPDIR_OUT}/report.json" -z "-config spider.maxDuration=5" >/dev/null 2>&1 || ZAP_EXIT=$?
  else
    "${ZAP_DIR}/${ZAP_SCRIPT}" -t "$TARGET_URL" -J "${TMPDIR_OUT}/report.json" >/dev/null 2>&1 || ZAP_EXIT=$?
  fi
fi

HANDLED_ERROR=1

# ZAP exit codes: 0 = pass, 1 = warnings, 2 = failures found -- all are valid results
if [[ $ZAP_EXIT -le 2 ]]; then
  if [[ -f "${TMPDIR_OUT}/report.json" ]]; then
    echo "{\"zap_json_path\": \"${TMPDIR_OUT}/report.json\", \"scan_type\": \"${SCAN_TYPE}\", \"target_url\": \"${TARGET_URL}\", \"exit_code\": 0}"
  else
    echo "{\"error\": \"scan_failed\", \"tool\": \"zap\", \"message\": \"ZAP completed but no report file was generated\", \"exit_code\": ${ZAP_EXIT}}"
  fi
else
  echo "{\"error\": \"scan_failed\", \"tool\": \"zap\", \"message\": \"ZAP exited with code ${ZAP_EXIT}\", \"exit_code\": ${ZAP_EXIT}}"
fi

exit 0
