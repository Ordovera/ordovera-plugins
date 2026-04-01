---
name: top10-setup
description: Detect your project stack, check scanning tool readiness, and install or provide commands for missing dependencies.
---

# Setup

Get the top10-scan plugin ready for your project. Detects your stack, checks which tools are available, and helps you install what's missing.

## Resolving plugin directory

Throughout this skill, `<plugin_dir>` refers to the root directory of this plugin. Resolve it by locating the directory containing this SKILL.md file and going two levels up (from `skills/top10-setup/SKILL.md` to the plugin root). The plugin root contains `scripts/`, `owasp-cache/`, and `templates/`.

## Step 1: Detect the Platform and Project

### Platform

Detect the operating system:
```bash
uname -s
```
- `Darwin` = macOS (use `brew` for installs)
- `Linux` = Linux (use `apt`, `yum`, or `pip` depending on distro)

Store the platform for tailoring install commands in Step 4.

### Project

Run framework detection:

```bash
python3 <plugin_dir>/scripts/detect-framework.py .
```

If Python is not available, check manually for framework markers (package.json, requirements.txt, pyproject.toml, Cargo.toml, *.csproj, go.mod, composer.json, Gemfile).

Tell the user what was detected:

> Detected: [framework(s)], [languages], package managers: [list from package_managers array]

This determines which tools are relevant. Only check and recommend tools that apply to this project -- a Node.js developer does not need to see guidance about cargo-audit.

**If no framework or package manager is detected**, check all common tools and note: "No specific framework detected. Checking all available scanning tools."

## Step 2: Check Tools

Run all checks in this step before presenting results. Do not present findings one at a time -- gather everything first.

### Python 3 (required for helper scripts)

```bash
python3 --version
```

Record: installed (with version) or missing.

### Opengrep (SAST layer)

```bash
which opengrep && opengrep --version 2>/dev/null
```

Record: installed (with version) or missing.

### SCA tools (check each detected package manager)

For each entry in the `package_managers` array, check the corresponding tool:

**npm/yarn/pnpm:**
```bash
npm --version
```
npm audit is built into npm. If npm is installed, SCA is ready.

**pip (Python):**
```bash
pip-audit --version 2>/dev/null
```

**cargo (Rust):**
```bash
cargo audit --version 2>/dev/null
```

**bundler (Ruby):**
```bash
bundle-audit version 2>/dev/null
```

**composer (PHP):**
```bash
composer --version 2>/dev/null
```
Composer 2.4+ has `composer audit` built in.

**nuget (.NET):**
```bash
dotnet --version 2>/dev/null
```
`dotnet list package --vulnerable` is built into the .NET CLI.

**go:**
```bash
govulncheck -version 2>/dev/null
```

Record: which SCA tools apply, installed or missing, for each detected package manager.

### ZAP (DAST layer)

```bash
docker images zaproxy/zap-stable --format "{{.Repository}}:{{.Tag}}" 2>/dev/null
```

If no Docker or no image:
```bash
which zap-cli 2>/dev/null || which zap.sh 2>/dev/null
```

Record: installed (Docker or local) or missing.

## Step 3: Present Results

**If all tools are already installed**, skip to Step 5:

> All tools ready. You're set for a full security audit.

Otherwise, show the readiness table with only project-relevant tools:

```
Project: [detected framework(s)] ([languages])
Platform: [macOS / Linux]

| Layer   | Tool               | Status    |
|---------|--------------------|-----------|
| Scripts | Python 3.12        | Installed |
| SAST    | Opengrep           | Missing   |
| SCA     | npm audit          | Ready     |
| SCA     | pip-audit          | Missing   |
| DAST    | ZAP (Docker)       | Missing   |
```

If multiple package managers were detected, show a row for each SCA tool.

For each missing tool, include a one-line description of what it does and what happens without it:

- **Opengrep** -- Scans source code for vulnerability patterns. Without it, design review still covers the same OWASP categories but without automated pattern matching.
- **pip-audit** -- Scans Python dependencies for known CVEs. Without it, the SCA layer is skipped for Python packages.
- **ZAP** -- Tests running applications for runtime vulnerabilities. Without it, the DAST layer is skipped. Most issues are still caught by SAST and design review.

## Step 4: Offer Installation

If any tools are missing, present two clear options:

> Missing tools: [list]
>
> How would you like to proceed?
> 1. **Install now** -- I'll run the install commands for you (you'll approve each one)
> 2. **Get install commands** -- I'll list the commands so you can run them yourself

Wait for the user to choose.

### Option 1: Install now

Run the install commands one at a time. The user will be prompted to approve each command via the normal tool permission flow.

Install order (dependencies first):

1. Python 3 (if missing -- everything else depends on it)
   - macOS: `brew install python3`
   - Linux: `sudo apt install python3` (Debian/Ubuntu) or `sudo dnf install python3` (Fedora)

2. Opengrep (if missing)
   - Both platforms: `curl -fsSL https://raw.githubusercontent.com/opengrep/opengrep/main/install.sh | bash`
   - After install, ensure `~/.local/bin` is on PATH: `export PATH="$HOME/.local/bin:$PATH"`
   - Verify: `which opengrep && opengrep --version`
   - Alternative: download binary from https://github.com/opengrep/opengrep/releases

3. SCA tool for each detected package manager that's missing:
   - pip-audit: `pip install pip-audit`
   - cargo-audit: `cargo install cargo-audit`
   - bundler-audit: `gem install bundler-audit`
   - govulncheck: `go install golang.org/x/vuln/cmd/govulncheck@latest`
   - npm audit / composer audit / dotnet: built-in, install the platform instead

4. ZAP (if missing)
   - Docker (both platforms): `docker pull zaproxy/zap-stable`
   - macOS native: `brew install --cask zap`

After each install, verify it succeeded:
```bash
which <tool> && <tool> --version
```

**If verification fails**, report the error and tell the user: "Install of [tool] failed. You can try installing it manually later. Continuing with remaining tools." Do NOT attempt to install an alternative tool. If opengrep fails, point the user to https://github.com/opengrep/opengrep/releases for manual download.

**If the user denies a command** (via the tool permission prompt), treat that tool as "skipped by user" and move to the next one. Do not retry.

After all installs, re-run the readiness check and show the updated table.

### Option 2: Get install commands

Print a copy-pasteable block with only the missing tools, tailored to the detected platform:

For both macOS and Linux:
```bash
# top10-scan: install missing dependencies

# SAST - static code analysis (opengrep)
curl -fsSL https://raw.githubusercontent.com/opengrep/opengrep/main/install.sh | bash
# Ensure ~/.local/bin is on PATH
export PATH="$HOME/.local/bin:$PATH"

# SCA - dependency vulnerability scanning
pip install pip-audit

# DAST - dynamic application testing
docker pull zaproxy/zap-stable
```

Only include tools that are actually missing and relevant to the project.

End with:

> After installing, run `/top10-scan:top10-setup` again to verify everything is detected.

## Step 5: Next Steps

After setup is complete (whether all tools are installed or the user chose to skip some):

> Ready to scan. Next steps:
> 1. `/top10-scan:attack-surface` -- Map your project's security surface (no tools needed)
> 2. `/top10-scan:security-audit` -- Full 7-layer audit

If external tools are missing but Python is available:

> You can run scans now -- missing tools are skipped gracefully. The design review layer always runs and covers all 10 OWASP categories.

## Behavior Rules

- Detect platform and project first, then only check relevant tools
- If no framework is detected, check all common tools
- Gather all results before presenting -- do not drip-feed findings
- Always offer both options (install now vs get commands) -- never install without asking
- When installing, run one command at a time so the user can approve each
- If the user denies a command, skip that tool and continue
- If an install fails, report the error and continue with remaining tools
- After installs, re-check and show updated status
- Skip tools that do not apply to the detected stack (unless no stack detected)
- NEVER substitute a different tool for a missing one. If opengrep install fails, report the failure and suggest the user install it manually from https://github.com/opengrep/opengrep/releases. Do not install semgrep or any other tool as a replacement. The plugin scripts expect the exact tools specified.
