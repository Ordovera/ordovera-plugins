# mcp-audit

MCP server governance posture analysis. Surfaces accountability gaps -- ungated writes, auth without attribution, destructive tools without audit trails -- across MCP server ecosystems. Combines automated static analysis (via `cc-mcp-audit`) with interpretive review.

This plugin assesses governance posture, not vulnerability surface. It does not detect path traversal, SQL injection, prompt injection, or dependency CVEs. For deployment decisions, pair with `/top10-scan:sast-scan` and `/top10-scan:sca-scan`.

## Install

```bash
/plugin marketplace add ordovera/ordovera-plugins
/plugin install mcp-audit@ordovera-plugins
```

## Prerequisites

The `cc-mcp-audit` CLI must be available. It ships as a TypeScript package in this monorepo under [`packages/cc-mcp-audit/`](../../packages/cc-mcp-audit/).

From the repo root:

```bash
cd packages/cc-mcp-audit && npm install && npm run build
```

Verify with `npx cc-mcp-audit --help`. See the [cc-mcp-audit README](../../packages/cc-mcp-audit/README.md) for full CLI usage.

## Quick Start

Audit a single MCP server repository:

```bash
/mcp-audit:mcp-audit
```

Provide a GitHub URL, local path, or candidates file from discovery. The skill runs the CLI, interprets the output, and presents a governance posture report.

Discover MCP servers for bulk analysis:

```bash
/mcp-audit:mcp-discover
```

Searches curated lists and GitHub, filters by language and star count, and produces a candidates file consumable by the audit skill.

## What It Checks

Five named accountability gap patterns:

| Pattern | Confidence | What It Means |
|---|---|---|
| ungated-write | High | Write tools with no confirmation gate co-located |
| global-auth-over-sensitive-tools | High/Low | Uniform auth across tools with different sensitivity |
| auth-without-actor-logging | High | Auth present but log statements lack principal identifiers |
| logging-without-attribution | Medium | Logging present but no principal identifiers and no auth |
| destructive-without-audit-trail | High | Irreversible operations (drop, delete, truncate) with no logging |

Per-server governance posture assessment:

- **Authorization**: Global / Per-tool / None / Delegated
- **Logging**: Comprehensive / Partial / None -- attributed or unattributed
- **Gates**: Default-safe / Default-unsafe / Absent

Optional `--llm-screen` flag adds Domain 5 triage hints (self-modification prevention, sub-agent authority constraints, permission boundary enforcement) to prioritize human review order.

## Skills

### /mcp-audit:mcp-audit

Analyze MCP servers for governance posture. Accepts GitHub URLs, local paths, or candidates files from discovery. Runs the `cc-mcp-audit` CLI, interprets the five accountability gap patterns, and presents a per-server governance posture report with risk summary.

### /mcp-audit:mcp-discover

Discover MCP server candidates from curated lists (awesome-mcp-servers, official MCP servers list) and GitHub search. Filters by language, star count, and deduplicates into a candidates file for bulk analysis.

## Output

Per-server reports include:

- Tool inventory (name, classification, sensitive keywords)
- Governance posture (auth architecture, logging attribution, confirmation gates)
- Accountability gaps with evidence locations and review notes
- Risk summary (sensitive tool count, key concern)

Multi-server reports add a comparison table and cross-server pattern summary.

## Relationship to Other Plugins

- **mcp-audit** (this plugin) assesses governance posture -- who can do what, can you trace it
- **top10-scan** assesses vulnerability surface -- OWASP Top 10 security scanning
- **context-setup** documents MCP servers in AGENTS.md via `/context-setup:context-mcp` -- optimization and trust boundary documentation

For deployment decisions, run governance audit (mcp-audit) and security audit (top10-scan) together.

## Updating

The plugin auto-updates via git SHA tracking. To verify you have the latest:

```bash
/plugin update mcp-audit@ordovera-plugins
```

## Known Limits

- Servers showing `hasAuth: false` may delegate auth to the MCP transport layer -- not necessarily a gap
- `hasAttributedLogging` requires principal identifiers within 3 lines of a log call -- file-wide presence does not count
- Low-confidence gaps require manual verification before citing
- "No tools extracted" with a framework-detected warning means the server uses a registration pattern not covered by regex extraction -- read source to complete the inventory
- Domain 5 screening hints (via `--llm-screen`) are triage aids, not findings -- do not copy them into final assessments without human verification

## References

Official Claude Code documentation relevant to MCP governance:

- [How Claude remembers your project](https://code.claude.com/docs/en/memory) -- CLAUDE.md files, `.claude/rules/`, auto memory, instruction hierarchy
- [Hooks](https://code.claude.com/docs/en/hooks) -- hook events for enforcement of governance policies
- [Settings](https://code.claude.com/docs/en/settings) -- managed settings, `permissions.deny` for tool blocking

MCP specification:

- [MCP Specification](https://spec.modelcontextprotocol.io/) -- protocol definition, tool annotations, transport types
- [MCP Security Notifications](https://modelcontextprotocol.io/specification/2025-03-26/basic/security) -- security considerations for MCP implementations

Related resources:

- [cc-mcp-audit package](../../packages/cc-mcp-audit/) -- the CLI that powers this plugin
- [cc-sc-verify package](../../packages/cc-sc-verify/) -- supply chain integrity checker for installed plugins
- [context-setup plugin](../context-setup/) -- MCP optimization and trust boundary documentation
- [top10-scan plugin](../top10-scan/) -- OWASP Top 10 security scanning

## Disclaimer

This software is provided as-is, without warranty of any kind. The authors and contributors are not liable for any damages or losses arising from its use. Governance posture analysis is not a substitute for professional security audits, penetration testing, or compliance review. Findings may include false positives or miss real governance gaps. Always validate findings independently before acting on them.
