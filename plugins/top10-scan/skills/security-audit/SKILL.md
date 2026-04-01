---
name: security-audit
description: Full OWASP Top 10:2025 security audit. Runs all layers -- framework detection, attack surface, SAST, SCA, DAST (if URL provided), design review, and synthesis.
---

# Security Audit (Full)

Run a complete multi-layer security audit mapped to OWASP Top 10:2025. This is the comprehensive option -- it orchestrates every available tool and produces a unified report.

For targeted scans, use the focused skills instead: `/top10-scan:attack-surface`, `/top10-scan:sast-scan`, `/top10-scan:sca-scan`, `/top10-scan:dast-scan`.

## Resolving plugin directory

`<plugin_dir>` refers to the root directory of this plugin. Resolve it by locating the directory containing this SKILL.md file and going two levels up (from `skills/security-audit/SKILL.md` to the plugin root). The plugin root contains `scripts/`, `owasp-cache/`, and `templates/`.

## Reference Data

OWASP Top 10:2025 category definitions, CWE mappings, and per-category design review prompts with framework-specific hints are defined in `<plugin_dir>/owasp-cache/`. See `top10.json` for categories and CWEs, `review-prompts.json` for design review checklists, and `state.json` for cache currency.

## Step 1: Framework Detection

Run the detection script against the current project:

```bash
python3 <plugin_dir>/scripts/detect-framework.py .
```

Parse the JSON output. Store `frameworks`, `languages`, and `package_managers` (array) for use in subsequent steps.

**Inline fallback:** If Python is unavailable or the user denies the command, manually check for framework markers:
- next.config.* (Next.js), manage.py + settings.py (Django), Gemfile + config/routes.rb (Rails)
- go.mod (Go), Cargo.toml (Rust), *.csproj with Microsoft.AspNetCore (ASP.NET)
- package.json dependencies for express, fastify, koa
- requirements.txt/pyproject.toml for fastapi
- Detect languages from file extensions

Tell the user what was detected before proceeding.

## Step 2: Tool Availability Check

Before starting the audit, check which tools are available. Run these checks:

```bash
which opengrep >/dev/null 2>&1 && echo "sast:ok" || echo "sast:missing"
```

For each entry in the `package_managers` array, check the corresponding SCA tool:
- npm: `which npm` (built-in)
- pip: `which pip-audit`
- cargo: `cargo audit --version`
- bundler: `bundle-audit version`
- go: `which govulncheck`
- composer: `which composer`
- nuget: `which dotnet`

Check DAST (only relevant if the user provided a URL):
```bash
docker images zaproxy/zap-stable --format "{{.Repository}}" 2>/dev/null || which zap-cli 2>/dev/null || echo "dast:missing"
```

Present the tool status up front, listing each tool specifically:

> Tool readiness:
> - SAST (Opengrep): [Installed / Missing]
> - SCA (npm audit): [Ready / Missing]
> - SCA (pip-audit): [Ready / Missing]
> - DAST (ZAP): [Installed / Missing / Skipped -- no URL provided]
> - Design Review: Ready (always available)

Only show SCA rows for detected package managers.

**If all scanning tools are missing**, stop and ask:

> No scanning tools are installed. This audit will run design review only (Claude analyzes the codebase against OWASP checklists). This still produces valuable findings, but automated scanning adds pattern detection, dependency checks, and runtime testing.
>
> Options:
> 1. **Proceed with design review only**
> 2. **Run setup first** -- `/top10-scan:top10-setup` to install scanning tools

Wait for the user to choose.

**If some tools are missing**, note specifically which layers will run and which will be skipped, then proceed without blocking:

> [N] of [M] scanning tools available. Will run: [list]. Will skip: [list]. Design review covers all OWASP categories regardless. Run `/top10-scan:top10-setup` to install missing tools.

**If all tools are available**, proceed without interruption.

## Step 3: Attack Surface Discovery

Read the project structure and identify:

1. **Endpoints**: All API routes, pages, and URL patterns. For each: route path, HTTP method, auth requirements, data handled.
2. **Authentication mechanisms**: Session, JWT, OAuth, API keys -- how they're implemented, where validated.
3. **External integrations**: Third-party APIs, databases, message queues, file storage -- connection methods and credential handling.
4. **Secrets handling**: Environment variables, config files, hardcoded values -- storage method and exposure risk.
5. **Trust boundaries**: Where user input enters the system, where data crosses privilege levels.

**For large projects** (many route files, hundreds of endpoints): Focus on auth-adjacent routes, admin endpoints, routes handling PII/credentials, and external integrations. Note in the output which areas were analyzed in depth vs. which need further review.

**For monorepos with multiple services**: Analyze all services but organize findings by service.

Store this as a structured attack surface map. It informs severity scoring in the synthesis step and focus areas for the design review.

## Step 4: SAST (Opengrep)

Run static analysis for each detected language. If multiple languages are detected, run once per language and combine:

```bash
bash <plugin_dir>/scripts/run-opengrep.sh . <language>
```

Check for `"error"` key in the JSON output:
- `"tool_not_installed"`: Already noted in Step 2. Log "SAST: skipped (Opengrep not installed)" and continue.
- `"unsupported_language"`: Log "SAST: skipped for [language] (no rules available)" and continue.
- `"scan_failed"`: Log "SAST: failed ([message])" and continue.

If the user denies the bash command, treat as skipped and continue.

If successful, parse the SARIF output:

```bash
python3 <plugin_dir>/scripts/parse-sarif.py <sarif_path>
```

Write normalized findings to a temp file.

## Step 5: SCA (Dependency Scanning)

Run dependency scanning for each detected package manager (from the `package_managers` array):

```bash
bash <plugin_dir>/scripts/run-sca.sh . <package_manager_name>
```

If the project has multiple package managers (e.g., npm + pip in a monorepo), run SCA for each one and combine the results.

If degradation response for any, log which tool is missing and continue with the others. If the user denies a bash command, treat as skipped.

Map findings to A03:2025 (Software Supply Chain Failures). Cross-reference vulnerable dependencies against the attack surface -- a vulnerable dep used in an unauthenticated endpoint is higher severity than one used only in build tooling.

Write combined SCA findings to a temp file.

## Step 6: DAST (Dynamic Testing)

ONLY run if the user provided a target URL in the message that invoked this skill, or if they clearly indicated a target URL earlier in the conversation. If no URL was provided, skip this step entirely and note "DAST: skipped (no target URL provided)."

**Production warning:** If the URL is not localhost/127.0.0.1/staging, warn before proceeding.

**Docker networking:** If ZAP runs via Docker and the URL is localhost:
- macOS: rewrite to `host.docker.internal`
- Linux: warn about potential connectivity issues

```bash
bash <plugin_dir>/scripts/run-zap.sh <target_url> baseline <framework>
```

If degradation response or the user denies the command, log and continue. Parse results if successful:

```bash
python3 <plugin_dir>/scripts/parse-zap.py <zap_json_path>
```

Write findings to a temp file.

## Step 7: Design Review

This ALWAYS runs regardless of tool availability. This is Claude's primary contribution.

Read the review prompts: `<plugin_dir>/owasp-cache/review-prompts.json`

For each OWASP Top 10:2025 category (A01-A10):

1. Load the category's review prompt
2. If a framework was detected, incorporate the framework-specific hints
3. Analyze the codebase against the prompt's checklist items
4. **Prioritize based on attack surface**: Spend the most analysis time on categories where the attack surface revealed gaps. For example, if many unauthenticated endpoints were found, prioritize A01. For categories with no relevant attack surface findings, do a quick check rather than exhaustive analysis.
5. For each finding: identify the specific code location, describe the vulnerability, assess severity, provide a fix

Produce findings in the standard schema:
```json
{
  "rule_id": "design-review-A01-001",
  "title": "Missing authorization on admin endpoint",
  "severity": "HIGH",
  "file": "src/routes/admin.ts",
  "line": 15,
  "cwe": [862],
  "description": "...",
  "source": "design_review",
  "recommendation": "..."
}
```

Write design review findings as JSON to a temp file.

## Step 8: Synthesis

Combine all findings into a unified report:

```bash
python3 <plugin_dir>/scripts/synthesize.py \
  --sast-findings <sast_json_path> \
  --sca-findings <sca_json_path> \
  --dast-findings <dast_json_path> \
  --design-findings <design_json_path> \
  --attack-surface <surface_json_path> \
  --framework <framework> \
  --owasp-cache <plugin_dir>/owasp-cache \
  --output-dir .
```

Only include `--*-findings` flags for layers that actually produced results. Omit flags for skipped layers.

**Inline fallback:** If synthesize.py fails or the user denies the command, perform synthesis manually:

1. **CWE Mapping**: Read `<plugin_dir>/owasp-cache/top10.json`, map each finding's CWE to its OWASP category
2. **Deduplication**: Group by (file+line+cwe) for SAST, (url+param+cwe) for DAST, (package+cwe) for SCA
3. **Severity Scoring**: 5-factor model (attack vector, exposure, data sensitivity, exploitability, impact). Score range 5-15: 13-15=Critical, 10-12=High, 7-9=Medium, 4-6=Low
4. **Cross-layer correlation**: Mark findings confirmed by multiple tools
5. **Report**: Generate markdown grouped by OWASP category

Present the final report with:
- Executive summary with finding counts by severity
- Findings grouped by OWASP Top 10 category
- Attack surface overview
- Tool coverage (what ran, what was unavailable, what was skipped)
- Recommendations prioritized by severity

## Graceful Degradation

1. Never fail the entire audit because one tool is unavailable
2. Design review ALWAYS runs -- it requires no external tools
3. When a tool is unavailable, note it in the Tool Coverage section
4. Each script handles its own degradation -- check for `"error"` key in output
5. If the user denies any bash command, treat it as tool unavailable and continue

## OWASP Version Check

On invocation, read `<plugin_dir>/owasp-cache/state.json`. If `last_checked` + `check_interval_hours` has elapsed, note this at the end of the report as an advisory:

> OWASP cache is [N] days old. Run `python3 <plugin_dir>/scripts/update-owasp.py` to check for updates.

Never interrupt a running audit for version management. Never block the audit on this check.

## Key Constraints

- All external tools are optional
- Report in both Markdown and SARIF 2.1.0
- Severity uses CVSS-inspired 5-factor model
- Focus on high-risk areas from the attack surface to manage context budget
- Prioritize actionable results over volume
- If the user denies a command at any step, continue with remaining steps
- ALWAYS use the provided scripts (run-opengrep.sh, run-sca.sh, run-zap.sh, parse-sarif.py, parse-zap.py, synthesize.py) rather than running tools directly. The scripts handle graceful degradation, output normalization, and bash compatibility. Do not bypass them.
- NEVER substitute a different tool (e.g., semgrep) for opengrep. If opengrep is missing, log it as skipped and continue.
