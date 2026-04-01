---
name: sast-scan
description: Static analysis with Opengrep SAST plus Claude design review, mapped to OWASP Top 10:2025.
---

# SAST Scan

Run static application security testing using Opengrep, combined with Claude's design-level review. Findings are mapped to OWASP Top 10:2025 categories via CWE.

For a complete audit including dependency and dynamic scanning, use `/top10-scan:security-audit` instead.

## Resolving plugin directory

`<plugin_dir>` refers to the root directory of this plugin. Resolve it by locating the directory containing this SKILL.md file and going two levels up (from `skills/sast-scan/SKILL.md` to the plugin root). The plugin root contains `scripts/`, `owasp-cache/`, and `templates/`.

## Reference Data

OWASP Top 10:2025 categories, CWE mappings, and design review prompts are defined in `<plugin_dir>/owasp-cache/`. See `top10.json` for CWE-to-category mapping and `review-prompts.json` for per-category checklists with framework hints.

## Step 1: Framework Detection

```bash
python3 <plugin_dir>/scripts/detect-framework.py .
```

Parse the JSON output. Store `frameworks`, `languages`, and `package_managers`. Tell the user what was detected.

**Inline fallback:** If Python is unavailable or the user denies the command, check for framework markers manually (next.config.*, manage.py, Gemfile, go.mod, Cargo.toml, *.csproj, package.json, requirements.txt, composer.json). Determine languages from file extensions (.ts, .py, .go, .rs, .cs, .java, .php, .rb).

## Step 2: SAST (Opengrep)

Run static analysis for each detected language. If multiple languages are detected (e.g., TypeScript and Python), run Opengrep once per language and combine results:

```bash
bash <plugin_dir>/scripts/run-opengrep.sh . <language>
```

Check the JSON output for an `"error"` key:

**If `"tool_not_installed"`:** Stop and ask the user before proceeding:

> Opengrep is not installed. This is the primary tool for SAST scanning.
>
> Options:
> 1. **Install now** -- I'll run the install command for your platform and then continue the scan
> 2. **Proceed without it** -- I'll run the design review only (covers the same OWASP categories but without automated pattern detection)
> 3. **Run setup instead** -- `/top10-scan:top10-setup` to check and install all tools

Install command (both platforms): `curl -fsSL https://raw.githubusercontent.com/opengrep/opengrep/main/install.sh | bash` -- then ensure `~/.local/bin` is on PATH.

Wait for the user to choose.

If the user chooses option 1 and install succeeds, re-run this step from the beginning.

If the user denies the install command, treat as option 2 (proceed without).

**If `"unsupported_language"`:** Tell the user: "Opengrep does not have rules for [language]. Continuing with design review, which covers all OWASP categories for any language." Proceed to Step 3.

**If `"scan_failed"`:** Tell the user: "Opengrep encountered an error: [message]. Continuing with design review." Proceed to Step 3.

**If successful**, parse the SARIF output:

```bash
python3 <plugin_dir>/scripts/parse-sarif.py <sarif_path>
```

Write the normalized findings to a temp file for synthesis.

## Step 3: Design Review

This ALWAYS runs regardless of whether Opengrep is available.

Read the review prompts: `<plugin_dir>/owasp-cache/review-prompts.json`

For each OWASP Top 10:2025 category (A01-A10):

1. Load the category's review prompt
2. If a framework was detected, incorporate the framework-specific hints
3. Analyze the codebase against the prompt's checklist items
4. For each finding: identify the specific code location, describe the vulnerability, assess severity, provide a fix

Produce findings with source set to `"design_review"`.

Write the design review findings as JSON to a temp file for synthesis. Use the standard finding schema:

```json
{
  "rule_id": "design-review-A01-001",
  "title": "...",
  "severity": "HIGH",
  "file": "...",
  "line": 0,
  "cwe": [862],
  "description": "...",
  "source": "design_review",
  "recommendation": "..."
}
```

## Step 4: Synthesis

Combine SAST and design review findings:

```bash
python3 <plugin_dir>/scripts/synthesize.py \
  --sast-findings <sast_json_path> \
  --design-findings <design_json_path> \
  --framework <framework> \
  --owasp-cache <plugin_dir>/owasp-cache \
  --output-dir .
```

Only include `--sast-findings` if Opengrep ran successfully.

**Inline fallback:** If synthesize.py fails or the user denies the command:

1. Map each finding's CWE to OWASP category using `<plugin_dir>/owasp-cache/top10.json`
2. Deduplicate SAST findings by (file, line, cwe)
3. Apply severity scoring: 5-factor model, range 5-15
4. Present markdown report grouped by OWASP category

## Graceful Degradation

- If Opengrep is unavailable (after the user chose to proceed without it), the design review still runs
- Minimum output = framework detection + design review findings
- Never fail the entire skill because a tool is missing -- but always inform the user what was skipped
- If the user denies any bash command, treat it as tool unavailable and continue

## Key Constraints

- Severity uses CVSS-inspired 5-factor model
- Prioritize actionable results over volume
- Focus on code patterns, not theoretical risks
- ALWAYS use the provided scripts (run-opengrep.sh, parse-sarif.py, synthesize.py) rather than running tools directly. The scripts handle graceful degradation, output normalization, and bash compatibility. Do not bypass them.
- NEVER substitute a different tool (e.g., semgrep) for opengrep. If opengrep is missing, follow the install or skip flow above.
