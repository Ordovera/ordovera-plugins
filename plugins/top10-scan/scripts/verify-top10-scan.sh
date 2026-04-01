#!/usr/bin/env bash
# Wrapper for top10-scan verification
exec python3 "$(dirname "$0")/verify-top10-scan.py" "$@"
