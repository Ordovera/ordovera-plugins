# top10-scan

Multi-layer security audit mapped to OWASP Top 10:2025. Combines Opengrep SAST, ZAP DAST, dependency scanning, and Claude's design-level analysis into a single synthesized report.

Unlike single-layer security tools, top10-scan orchestrates multiple scanning approaches and cross-correlates findings. A SQL injection found by SAST that maps to an unauthenticated endpoint found during attack surface discovery gets elevated severity. A vulnerable dependency found by SCA that's only used in dev tooling gets downweighted.

## Install

```bash
/plugin marketplace add ordovera/ordovera-plugins
/plugin install top10-scan@ordovera-plugins
```

## Quick Start

Check what scanning tools you have installed:

```bash
/top10-scan:top10-setup
```

Map the attack surface (no tools required):

```bash
/top10-scan:attack-surface
```

Run a full audit:

```bash
/top10-scan:security-audit
```

Or run targeted scans:

```bash
/top10-scan:sast-scan
/top10-scan:sca-scan
/top10-scan:dast-scan
```

## Tool Dependencies

All external tools are optional. The plugin degrades gracefully when tools are missing.

| Tool | Type | Purpose | Install |
| ---- | ---- | ------- | ------- |
| Opengrep | SAST | Static code analysis | `brew install opengrep` or see opengrep.dev |
| ZAP | DAST | Dynamic app testing | `docker pull zaproxy/zap-stable` |
| npm audit | SCA | Node.js dependency scan | Included with npm |
| pip-audit | SCA | Python dependency scan | `pip install pip-audit` |
| Python 3 | Runtime | Script execution | Usually pre-installed |

**Minimum requirements:** Python 3 for script execution. Without Python, skills fall back to inline analysis (framework detection and design review still work).

**Zero tools installed?** `/top10-scan:attack-surface` and the design review layer in `/top10-scan:sast-scan` require nothing -- Claude reads the codebase directly.

## Skills

### /top10-scan

Entry point. Lists available skills and recommends where to start based on your request.

### /top10-scan:top10-setup

Checks which scanning tools are installed, reports readiness per layer, and provides install commands for anything missing. Run this once after installing the plugin.

### /top10-scan:security-audit

Full audit. Runs all 7 layers: framework detection, attack surface discovery, SAST (Opengrep), SCA (dependency scan), DAST (ZAP, if URL provided), design review, and synthesis. Produces a markdown report and SARIF output grouped by OWASP Top 10 category.

### /top10-scan:attack-surface

Maps the project's attack surface: endpoints, authentication mechanisms, external integrations, secrets handling, and trust boundaries. No external tools required. Good first step before a full audit or when exploring an unfamiliar codebase.

### /top10-scan:sast-scan

Static analysis with Opengrep plus Claude's design-level review against all 10 OWASP categories. If Opengrep is not installed, the design review still runs and provides comprehensive coverage.

### /top10-scan:sca-scan

Dependency vulnerability scanning. Auto-detects the package manager and runs the appropriate tool (npm audit, pip-audit, yarn audit, cargo-audit, bundler-audit, composer audit, or dotnet). Maps findings to A03:2025 (Software Supply Chain Failures) and cross-references with other categories.

### /top10-scan:dast-scan

Dynamic testing against a running application. Requires a target URL. Uses OWASP ZAP with framework-aware configuration (AJAX spider for SPAs, etc.). Runs a baseline scan by default.

## How It Works

The full audit orchestrates 7 layers:

1. **Framework Detection** -- Identifies project technology stack (Next.js, Express, Django, FastAPI, Rails, Spring, ASP.NET, Go, Rust, PHP)
2. **Attack Surface Discovery** -- Claude reads the project to map endpoints, auth flows, integrations, and trust boundaries
3. **SAST** -- Opengrep scans source code with rules filtered by CWE relevance to OWASP Top 10
4. **SCA** -- Dependency scanning identifies known vulnerabilities in third-party packages
5. **DAST** -- ZAP tests the running application for runtime vulnerabilities
6. **Design Review** -- Claude analyzes architecture against per-category security checklists with framework-specific guidance
7. **Synthesis** -- Cross-correlates findings, deduplicates, applies 5-factor severity scoring, generates report

Each skill runs a subset of these layers. The attack surface skill runs layers 1-2. SAST runs 1, 3, 6, 7. SCA runs 1, 4, 7. DAST runs 1, 5, 7.

## Severity Model

Findings are scored on 5 factors (1-3 each, total 5-15):

| Factor | High (3) | Medium (2) | Low (1) |
| ------ | -------- | ---------- | ------- |
| Attack vector | Network | Adjacent | Local |
| Exposure | Unauth endpoint | Auth endpoint | Internal only |
| Data sensitivity | PII/credentials | Business data | Public data |
| Exploitability | Known CVE | Requires chaining | Theoretical |
| Impact | Exfiltration/priv esc | Data modification | Info disclosure |

Composite: 13-15 Critical, 10-12 High, 7-9 Medium, 4-6 Low, 3 or below Informational.

## Output

Reports are generated in two formats:

- **Markdown** -- Human-readable report grouped by OWASP category
- **SARIF 2.1.0** -- Machine-readable format compatible with VS Code SARIF Viewer and CI/CD pipelines

## Supported Frameworks

Framework detection and review prompts cover: Next.js, Express, Fastify, Koa, Django, FastAPI, Rails, Spring, ASP.NET, Go, Rust, PHP/Laravel.

## OWASP Version Management

The plugin ships with OWASP Top 10:2025 mappings cached locally. Run `update-owasp.py --status` to check currency. The CWE-based mapping system means that when OWASP releases new versions, findings automatically re-map to updated categories.

## Updating

The plugin auto-updates via git SHA tracking (no version field in plugin.json). To verify you have the latest:

```bash
/plugin update top10-scan@ordovera-plugins
```

## Test Fixtures

The `test-fixtures/` directory contains seven intentionally vulnerable applications for testing:

- **vulnerable-nextjs/** -- A01, A03, A05, A07, A10 vulnerabilities
- **vulnerable-express/** -- A02, A03, A05, A08, A10 vulnerabilities
- **vulnerable-django/** -- A01, A02, A06, A07, A09 vulnerabilities
- **vulnerable-fastapi/** -- A01, A02, A05, A07, A10 vulnerabilities
- **vulnerable-php/** -- A01, A02, A04, A05, A09 vulnerabilities
- **vulnerable-aspnet/** -- A01, A02, A05, A08, A10 vulnerabilities
- **vulnerable-rust/** -- A01, A04, A05, A06, A10 vulnerabilities

Each has a README documenting planted vulnerabilities and expected results in `expected-results/`.

## Disclaimer

This software is provided as-is, without warranty of any kind. The authors and contributors are not liable for any damages, security incidents, or losses arising from its use. This plugin is a tool to assist with security analysis -- it does not guarantee the security of any codebase and is not a substitute for professional security audits, penetration testing, or compliance review. Findings may include false positives or miss real vulnerabilities. Always validate findings independently before acting on them.
