#!/usr/bin/env python3
"""
update-owasp.py - Check for OWASP Top 10 updates from the official GitHub repo.

Uses only stdlib (urllib for HTTP). Non-blocking: failures fall back to cached data.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError


DEFAULT_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "owasp-cache")
GITHUB_API_URL = "https://api.github.com/repos/OWASP/Top10/releases/latest"
GITHUB_TAGS_URL = "https://api.github.com/repos/OWASP/Top10/tags"


def load_state(cache_dir):
    """Load state.json from cache directory."""
    state_path = os.path.join(cache_dir, "state.json")
    if not os.path.isfile(state_path):
        return {
            "last_checked": "1970-01-01T00:00:00Z",
            "current_version": "unknown",
            "check_interval_hours": 24,
            "source_repo": "OWASP/Top10",
            "update_available": False,
        }
    with open(state_path, "r") as fh:
        return json.load(fh)


def save_state(cache_dir, state):
    """Save state.json to cache directory."""
    state_path = os.path.join(cache_dir, "state.json")
    os.makedirs(cache_dir, exist_ok=True)
    with open(state_path, "w") as fh:
        json.dump(state, fh, indent=2)
        fh.write("\n")


def is_cache_fresh(state):
    """Check if cache is within the check interval."""
    try:
        last = datetime.fromisoformat(state["last_checked"].replace("Z", "+00:00"))
        interval_hours = state.get("check_interval_hours", 24)
        now = datetime.now(timezone.utc)
        elapsed = (now - last).total_seconds() / 3600
        return elapsed < interval_hours
    except (ValueError, KeyError):
        return False


def fetch_latest_version():
    """Fetch the latest version info from GitHub API."""
    # Try releases endpoint first
    for url in [GITHUB_API_URL, GITHUB_TAGS_URL]:
        try:
            req = Request(url, headers={"User-Agent": "top10-scan/1.0"})
            with urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, dict) and "tag_name" in data:
                    return data["tag_name"]
                if isinstance(data, list) and data:
                    return data[0].get("name", data[0].get("tag_name", ""))
        except (URLError, HTTPError, json.JSONDecodeError, OSError):
            continue
    return None


def load_top10(cache_dir):
    """Load current top10.json."""
    path = os.path.join(cache_dir, "top10.json")
    if not os.path.isfile(path):
        return None
    with open(path, "r") as fh:
        return json.load(fh)


def check_missing_prompts(top10_data, cache_dir):
    """Flag categories that may be missing review prompts."""
    if not top10_data:
        return []
    missing = []
    prompts_dir = os.path.join(cache_dir, "..", "prompts")
    categories = top10_data.get("categories", [])
    for cat in categories:
        cat_id = cat["id"].lower()
        prompt_file = os.path.join(prompts_dir, "{}.md".format(cat_id))
        if not os.path.isfile(prompt_file):
            missing.append(cat["id"])
    return missing


def output_result(status, current_version, message):
    """Print JSON result to stdout."""
    result = {
        "status": status,
        "current_version": current_version,
        "message": message,
    }
    print(json.dumps(result))


def main():
    parser = argparse.ArgumentParser(description="Check for OWASP Top 10 updates")
    parser.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR,
                        help="Path to owasp-cache directory")
    parser.add_argument("--force", action="store_true",
                        help="Re-fetch regardless of interval")
    parser.add_argument("--status", action="store_true",
                        help="Show current version info and exit")
    args = parser.parse_args()

    state = load_state(args.cache_dir)
    current_version = state.get("current_version", "unknown")

    # Status-only mode
    if args.status:
        top10 = load_top10(args.cache_dir)
        cat_count = len(top10.get("categories", [])) if top10 else 0
        update_flag = state.get("update_available", False)
        msg = "Version: {}, Categories: {}, Update available: {}".format(
            current_version, cat_count, update_flag
        )
        output_result("up_to_date" if not update_flag else "update_available", current_version, msg)
        return

    # Check freshness
    if not args.force and is_cache_fresh(state):
        output_result("up_to_date", current_version, "Cache is fresh, skipping check.")
        return

    # Fetch latest version
    print("Checking OWASP/Top10 for updates...", file=sys.stderr)
    latest = fetch_latest_version()

    if latest is None:
        # Non-blocking failure
        state["last_checked"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        save_state(args.cache_dir, state)
        print("WARNING: Could not reach GitHub API. Using cached version.", file=sys.stderr)
        output_result("error", current_version, "Could not reach GitHub API. Using cached version.")
        return

    # Compare versions
    latest_clean = latest.lstrip("v").strip()
    if latest_clean != current_version:
        state["update_available"] = True
        state["last_checked"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        save_state(args.cache_dir, state)

        msg = "Update available: {} -> {}".format(current_version, latest_clean)
        print("ADVISORY: {}".format(msg), file=sys.stderr)

        if args.force:
            print("Force mode: updating version reference to {}".format(latest_clean), file=sys.stderr)
            state["current_version"] = latest_clean
            state["update_available"] = False
            save_state(args.cache_dir, state)

            # Check for missing prompts
            top10 = load_top10(args.cache_dir)
            missing = check_missing_prompts(top10, args.cache_dir)
            if missing:
                print("WARNING: Missing review prompts for categories: {}".format(
                    ", ".join(missing)), file=sys.stderr)
                msg += ". Missing prompts for: {}".format(", ".join(missing))

        output_result("update_available", current_version, msg)
    else:
        state["update_available"] = False
        state["last_checked"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        save_state(args.cache_dir, state)
        output_result("up_to_date", current_version, "Already at latest version ({}).".format(current_version))


if __name__ == "__main__":
    main()
