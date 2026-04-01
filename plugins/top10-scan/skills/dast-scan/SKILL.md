---
name: dast-scan
description: Dynamic application security testing with OWASP ZAP against a running target URL, mapped to OWASP Top 10:2025.
---

# DAST Scan

Run dynamic application security testing against a live target URL using OWASP ZAP. Findings are mapped to OWASP Top 10:2025 categories via CWE.

This skill requires a running application and Python 3 (for parsing results). For static-only analysis, use `/top10-scan:sast-scan` instead.

## Resolving plugin directory

`<plugin_dir>` refers to the root directory of this plugin. Resolve it by locating the directory containing this SKILL.md file and going two levels up (from `skills/dast-scan/SKILL.md` to the plugin root). The plugin root contains `scripts/`, `owasp-cache/`, and `templates/`.

## Reference Data

CWE-to-OWASP category mappings for finding classification are defined in `<plugin_dir>/owasp-cache/top10.json`.

## Prerequisites

**Target URL:** The user MUST provide a target URL. If no URL was provided in the message that invoked this skill (or clearly indicated earlier in the conversation), ask for one before proceeding:

> What URL should I scan? Example: `http://localhost:3000`

**Python 3:** Required for parsing ZAP results. Check:

```bash
python3 --version
```
If Python is unavailable, tell the user: "Python 3 is required for parsing ZAP output. Install Python first via `/top10-scan:top10-setup`, then re-run this skill."

**Production warning:** If the target URL does not appear to be a local or staging environment (i.e., it's not localhost, 127.0.0.1, a .local domain, or a staging/dev subdomain), warn the user:

> The target URL appears to be a production environment. Running ZAP against production can cause issues (rate limiting, WAF blocks, and may have legal implications). Are you sure you want to proceed?

Wait for confirmation.

## Step 1: Framework Detection

```bash
python3 <plugin_dir>/scripts/detect-framework.py .
```

Parse the JSON output. The detected framework informs ZAP's scan configuration (e.g., AJAX spider for SPAs). Tell the user what was detected.

**Inline fallback:** If the user denies the command, proceed without framework-specific configuration.

## Step 2: ZAP Scan

### Docker networking check

If ZAP will run via Docker and the target URL references `localhost` or `127.0.0.1`:

Detect the platform:

```bash
uname -s
```

- **macOS (Darwin):** Replace `localhost` / `127.0.0.1` in the URL with `host.docker.internal` when passing to the Docker command. Tell the user: "Rewriting URL to use `host.docker.internal` for Docker networking."
- **Linux:** The `run-zap.sh` script needs `--network host` added to the Docker command. Note: the current script does not handle this automatically. Tell the user: "On Linux, ZAP in Docker may not reach localhost. If the scan fails with a connection error, try running ZAP locally instead of via Docker."

### Run the scan

```bash
bash <plugin_dir>/scripts/run-zap.sh <target_url> baseline <framework>
```

Use `baseline` scan type by default. Only use `full` if the user explicitly requests a full/comprehensive scan. Baseline is faster and suitable for most use cases.

If the user provides a URL with a specific path (e.g., `http://localhost:3000/api`), note: "ZAP will use this URL as the starting point for crawling."

Check the JSON output for an `"error"` key:

**If `"tool_not_installed"`:** Stop and ask the user:

> ZAP is not installed. This is required for dynamic scanning.
>
> Options:
> 1. **Install now** -- I'll pull the Docker image or install ZAP
> 2. **Get install commands** -- Docker: `docker pull zaproxy/zap-stable` / macOS: `brew install --cask zap`
> 3. **Run setup instead** -- `/top10-scan:top10-setup` to check and install all tools

Detect platform (`uname -s`) to tailor the default install command.

Wait for the user to choose. If install succeeds, re-run the scan. If the user denies the command, exit with the install guidance.

**If `"scan_failed"`:** Check if this is likely a connection issue. Run a quick reachability check:

```bash
curl -s -o /dev/null -w '%{http_code}' <target_url> 2>/dev/null || echo "unreachable"
```

If unreachable, tell the user: "The target URL is not reachable. Make sure the application is running and the URL is correct."

If reachable but ZAP failed, report the error from the script output.

**If successful**, parse the ZAP report:

```bash
python3 <plugin_dir>/scripts/parse-zap.py <zap_json_path>
```

Write the normalized findings to a temp file for synthesis.

## Step 3: Synthesis

```bash
python3 <plugin_dir>/scripts/synthesize.py \
  --dast-findings <dast_json_path> \
  --framework <framework> \
  --owasp-cache <plugin_dir>/owasp-cache \
  --output-dir .
```

**Inline fallback:** If synthesize.py fails or the user denies the command:

1. Map each finding's CWE to OWASP category using `<plugin_dir>/owasp-cache/top10.json`
2. Deduplicate by (url, parameter, cwe)
3. Present findings sorted by severity

## Output

Present a report with:

- Summary of findings by severity and OWASP category
- Each finding with: title, severity, URL, HTTP method, parameter, CWE, OWASP category, description, recommendation
- Notes on scan coverage (which URLs were crawled, scan type used)

## Graceful Degradation

- ZAP is required for this skill. If unavailable and the user declines to install, suggest `/top10-scan:sast-scan` as an alternative
- If the target URL is unreachable, report the connection error and exit cleanly
- If the user denies any bash command, exit gracefully with guidance on what to run manually
- Python 3 is required for parsing. Without it, raw ZAP results cannot be processed

## Key Constraints

- Never run a full scan unless explicitly requested -- baseline is the default
- DAST findings are runtime-confirmed, so they generally have higher confidence than SAST
- ZAP exit codes 0-2 are all valid (0=pass, 1=warnings, 2=failures found)
- Warn before scanning production URLs
