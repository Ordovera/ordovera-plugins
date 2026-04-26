# Ordovera Plugins

Open source Claude Code plugins and CLI tools for building, securing, and governing AI agent systems.

## Plugins

Claude Code plugins installed via the marketplace. Each plugin provides skills (slash commands) that run inside Claude Code sessions.

### Install

```bash
/plugin marketplace add ordovera/ordovera-plugins
```

Then install the plugins you need:

```bash
/plugin install context-setup@ordovera-plugins
/plugin install top10-scan@ordovera-plugins
/plugin install mcp-audit@ordovera-plugins
```

### context-setup

Context engineering for Claude Code projects. Scaffold, audit, align, optimize MCP tools, estimate context budget, and upgrade context files. Generates AGENTS.md, `.claude/rules/`, context directories, and cascading structures from project analysis.

8 skills: scaffold, audit, align, upgrade, mcp, usage, budget, setup entry point.

Originally developed as part of [context-engineering](https://github.com/fending/context-engineering). [Full documentation](plugins/context-setup/README.md)

### top10-scan

OWASP Top 10:2025 multi-layer security audit. Orchestrates Opengrep (SAST), ZAP (DAST), and native package manager SCA alongside Claude's design-level analysis into a single synthesized report with 5-factor severity scoring.

7 skills: security-audit, attack-surface, sast-scan, sca-scan, dast-scan, top10-setup, entry point.

[Full documentation](plugins/top10-scan/README.md)

### mcp-audit

MCP server governance posture analysis. Surfaces accountability gaps (ungated writes, auth without attribution, destructive tools without audit trails) across MCP server ecosystems. Combines automated static analysis with interpretive review.

2 skills: mcp-audit, mcp-discover. Requires the cc-mcp-audit CLI (see below).

[Full documentation](plugins/mcp-audit/README.md)

## CLI Tools

Standalone npm packages that work without installing the plugins. Run with `npx` or install globally.

### cc-mcp-audit

Governance posture CLI for MCP servers. Extracts tool inventories, classifies sensitivity, detects auth/logging/gate patterns, and surfaces named accountability gaps. Powers the mcp-audit plugin but also works standalone in scripts and CI.

```bash
npx cc-mcp-audit <github-url-or-local-path> --format json
npx cc-mcp-audit discover --min-stars 50 -o candidates.json
```

[Full documentation](packages/cc-mcp-audit/README.md)

### cc-sc-verify

Supply chain integrity checker for Claude Code plugins. Verifies installed plugins against their source repos for tampering, version drift, repo deletion, and tool definition changes since install.

```bash
npx cc-sc-verify
npx cc-sc-verify --plugin context-setup@ordovera-plugins
```

[Full documentation](packages/cc-sc-verify/README.md)

## Repo Structure

```text
ordovera-plugins/
  plugins/
    context-setup/       Context engineering (8 skills)
    top10-scan/          OWASP security scanning (7 skills)
    mcp-audit/           MCP governance analysis (2 skills)
  packages/
    cc-mcp-audit/        npx cc-mcp-audit (governance posture CLI)
    cc-sc-verify/        npx cc-sc-verify (plugin supply chain checker)
```

Plugins are SKILL.md files (prompt orchestration) with supporting data and scripts. Packages are TypeScript (ES modules) with their own package.json, built with `npm run build`.

## Development

```bash
# Build all packages
npm run build --workspaces

# Test all packages
npm test --workspaces

# Verify plugins (contract + golden baseline tests)
npm run verify
```

## Disclaimer

This software is provided as-is, without warranty of any kind. See each plugin's README for plugin-specific disclaimers.

## License

MIT
