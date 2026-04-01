---
name: sca-scan
description: Dependency vulnerability scanning mapped to OWASP Top 10:2025 A03 (Software Supply Chain Failures).
---

# SCA Scan

Run software composition analysis to find known vulnerabilities in project dependencies. Findings are mapped primarily to A03:2025 (Software Supply Chain Failures) with cross-references to other categories where relevant.

For a complete audit, use `/top10-scan:security-audit` instead.

## Resolving plugin directory

`<plugin_dir>` refers to the root directory of this plugin. Resolve it by locating the directory containing this SKILL.md file and going two levels up (from `skills/sca-scan/SKILL.md` to the plugin root). The plugin root contains `scripts/`, `owasp-cache/`, and `templates/`.

## Reference Data

CWE-to-OWASP category mappings for finding classification are defined in `<plugin_dir>/owasp-cache/top10.json`.

## Step 1: Framework Detection

```bash
python3 <plugin_dir>/scripts/detect-framework.py .
```

Parse the JSON output. Read the `package_managers` array to determine which SCA tools to use. Tell the user what was detected.

**Inline fallback:** If Python is unavailable or the user denies the command, check for lockfiles and manifest files manually (package-lock.json, yarn.lock, Gemfile.lock, Pipfile.lock, poetry.lock, go.sum, composer.lock, Cargo.lock, requirements.txt, pyproject.toml, package.json, *.csproj).

**If no package managers are detected**, tell the user and exit:

> No package managers detected in this project. SCA scanning requires a manifest file (package.json, requirements.txt, Cargo.toml, go.mod, Gemfile, composer.json, or *.csproj). If this project manages dependencies differently, try `/top10-scan:sast-scan` for code-level analysis instead.

## Step 2: Dependency Scanning

Run the SCA script for each detected package manager. If multiple are detected (e.g., npm + pip in a monorepo), run SCA for each and combine results:

```bash
bash <plugin_dir>/scripts/run-sca.sh . <package_manager_name>
```

The script selects the appropriate tool per package manager:

- npm -> `npm audit --json`
- pip -> `pip-audit --format=json`
- yarn -> `yarn audit --json`
- cargo -> `cargo audit --json`
- bundler -> `bundle-audit check --format json`
- go -> `govulncheck -json ./...`
- nuget -> `dotnet list package --vulnerable --format json`
- composer -> `composer audit --format=json`
- Other -> OWASP Dependency-Check CLI

Check the JSON output for an `"error"` key. If `"tool_not_installed"`, **stop and ask the user**:

> [Tool name] is not installed. This is required for scanning [package manager] dependencies.
>
> Options:
> 1. **Install now** -- I'll run `[install command]` and then continue the scan
> 2. **Get install command** -- `[install command]` (you run it yourself, then re-run this skill)
> 3. **Run setup instead** -- `/top10-scan:top10-setup` to check and install all tools

Detect platform (`uname -s`) to tailor the install command.

Wait for the user to choose. If the user chooses option 1 and install succeeds, re-run the scan for that package manager. If the user denies the install command, treat as option 2.

There is no fallback for SCA -- without the tool, there are no results to report for that package manager. If some package managers succeeded and others didn't, present results for the ones that worked.

**If 0 vulnerabilities found across all package managers:**

> No known vulnerabilities found in [N] dependencies scanned across [package managers]. Dependencies are up to date.

## Step 3: Analysis

For each vulnerability found:

1. **Map to OWASP category**: Most map to A03:2025 (Supply Chain), but some CVEs cross-reference other categories (e.g., a vulnerable JWT library maps to both A03 and A07)
2. **Assess contextual severity**: Read the project to determine how the vulnerable dependency is used:
   - Is it a runtime dependency or dev-only?
   - Is it used in an unauthenticated code path?
   - Does it handle sensitive data?
3. **Check for fix availability**: Note whether a patched version exists and what upgrade is needed

## Step 4: Synthesis

Write the SCA findings as JSON to a temp file, then run:

```bash
python3 <plugin_dir>/scripts/synthesize.py \
  --sca-findings <sca_json_path> \
  --framework <framework> \
  --owasp-cache <plugin_dir>/owasp-cache \
  --output-dir .
```

**Inline fallback:** If synthesize.py fails or the user denies the command:

1. Map each finding's CWE to OWASP category using `<plugin_dir>/owasp-cache/top10.json`
2. Deduplicate by (package_name, cwe)
3. Present findings sorted by severity with upgrade recommendations

## Output

Present a report with:
- Summary of vulnerable dependencies by severity (and by ecosystem if multiple package managers)
- Each finding with: package name, installed version, vulnerability title, severity, CVE/CWE, fix version, OWASP category
- Contextual notes on how the dependency is used in the project
- Prioritized upgrade recommendations

## Graceful Degradation

- If the SCA tool is unavailable and the user declines to install, exit with the install guidance
- If the user denies a bash command, treat it the same as tool unavailable
- If no package manager is detected, exit cleanly with guidance
- If multiple package managers exist and some tools are missing, present results for the ones that worked

## Key Constraints

- Focus on actionable findings with available fixes
- Downweight dev-only dependencies
- Always note whether a fix version is available
