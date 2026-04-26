# cc-mcp-audit

Governance posture analysis for MCP servers. Extracts tool inventories, classifies sensitivity, detects auth/logging/gate patterns, and surfaces named accountability gaps. Does not detect code-level vulnerabilities -- pair with SAST and dependency scanning for deployment decisions.

## Install

From the ordovera-plugins monorepo:

```bash
cd packages/cc-mcp-audit && npm install && npm run build
```

Then run with:

```bash
npx cc-mcp-audit <github-url-or-local-path> --format json
```

Not yet published to npm. Must be built from source.

## Usage

```bash
# Analyze a single server by GitHub URL
cc-mcp-audit https://github.com/org/mcp-server --format json

# Analyze a local directory
cc-mcp-audit ./path/to/server --format json

# Analyze from a candidates file (from discover)
cc-mcp-audit -c candidates.json --format json

# Markdown report for multiple servers
cc-mcp-audit -c candidates.json --format markdown

# Write output to file
cc-mcp-audit -c candidates.json --format json -o report.json

# With LLM screening for Domain 5 triage hints
cc-mcp-audit https://github.com/org/mcp-server --llm-screen

# Discover MCP server candidates
cc-mcp-audit discover --min-stars 50 -o candidates.json
cc-mcp-audit discover --language TypeScript --language Python
cc-mcp-audit discover --skip-github  # curated lists only
```

## What It Checks

Five named accountability gap patterns:

| Pattern | Confidence | What It Means |
|---|---|---|
| ungated-write | High | Write tools with no confirmation gate co-located |
| global-auth-over-sensitive-tools | High/Low | Uniform auth across tools with different sensitivity |
| auth-without-actor-logging | High | Auth present but log statements lack principal identifiers |
| logging-without-attribution | Medium | Logging present but no principal identifiers and no auth |
| destructive-without-audit-trail | High | Irreversible operations (drop, delete, truncate) with no logging |

Per-server governance posture:

- **Authorization**: Global / Per-tool / None / Delegated
- **Logging**: Comprehensive / Partial / None -- attributed or unattributed
- **Gates**: Default-safe / Default-unsafe / Absent

## Discovery

The `discover` subcommand finds MCP server candidates from curated lists and GitHub search:

```bash
cc-mcp-audit discover [options]

Options:
  -o, --output <file>          Write candidates to file (default: stdout)
  --min-stars <n>              Minimum GitHub stars (default: 10)
  --updated-after <date>       Only repos pushed after this ISO date
  --language <lang>            Filter by language (repeatable)
  --exclude <pattern>          Exclude repos matching pattern (repeatable)
  --github-token <token>       GitHub API token (higher rate limits)
  --skip-github                Skip GitHub search, curated lists only
  --skip-curated               Skip curated lists, GitHub search only
  --existing <file>            Existing candidates file for deduplication
```

## LLM Screening

Optional `--llm-screen` adds Domain 5 triage hints for governance-relevant behavioral properties:

- Self-modification prevention
- Sub-agent authority constraints
- Permission boundary enforcement

Hints are `likely-present`, `likely-absent`, or `unclear` with cited file:line locations. They prioritize human review order -- they are not findings. Provider auto-detects Claude Code CLI if on PATH, otherwise uses `ANTHROPIC_API_KEY`.

## Environment

- **GITHUB_TOKEN** -- GitHub personal access token for discovery enrichment and higher API rate limits
- **ANTHROPIC_API_KEY** -- Required for `--llm-screen` if Claude Code CLI is not on PATH

## Relationship to the mcp-audit Plugin

This package is the CLI engine. The [mcp-audit plugin](../../plugins/mcp-audit/) wraps it with interpretive analysis -- it runs the CLI, reads the output, and presents a governance posture report with context-aware risk summaries.

You can use cc-mcp-audit standalone (in scripts, CI, batch analysis) or through the plugin (interactive, interpretive).

## Sibling packages and plugins

- [cc-sc-verify package](../cc-sc-verify/) -- supply chain integrity checker for installed plugins
- [mcp-audit plugin](../../plugins/mcp-audit/) -- interpretive wrapper for this CLI
- [context-setup plugin](../../plugins/context-setup/) -- MCP optimization and trust boundary documentation
- [top10-scan plugin](../../plugins/top10-scan/) -- OWASP Top 10 security scanning

## License

MIT
