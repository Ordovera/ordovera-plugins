# cc-sc-verify

Supply chain integrity checker for Claude Code plugins. Verifies installed plugins against their source repos for tampering, version drift, repo deletion, and tool definition changes since install.

## Install

```bash
npx cc-sc-verify
```

Also published as `sc-verify` for shorter invocation:

```bash
npx sc-verify
```

## What it does

Reads your installed plugin metadata from `~/.claude/plugins/` and checks each plugin's source repo on GitHub:

- **Repo status** -- Is the source repo still active, or has it been archived, deleted, or transferred to a different owner?
- **Version drift** -- Does your installed version match the latest commit, or are you behind?
- **Skill diff** -- Have skills been added or removed upstream since you installed?
- **Hook diff** -- Have hook files been added or removed upstream?
- **Description change** -- Has the plugin's description changed (potential scope change)?

## Usage

```bash
# Check all installed plugins
cc-sc-verify

# Check only plugins from a specific marketplace
cc-sc-verify --marketplace ordovera-plugins

# Check a single plugin
cc-sc-verify --plugin context-setup@ordovera-plugins

# JSON output (for piping to other tools)
cc-sc-verify --json

# With GitHub token for higher rate limits (5,000 vs 60 req/hr)
GITHUB_TOKEN=ghp_xxx cc-sc-verify
```

## Example output

```
Plugin Supply Chain Verification
================================
Checked: 2026-04-15 17:16:34 UTC
Plugins: 2 checked, 2 with issues

--- ordovera-plugins ---

[BEHIND] context-setup (ordovera-plugins)
  Repo: ordovera/ordovera-plugins
  Installed: 2026-04-02 | Last updated: 2026-04-02
  SHA: 6c97949accf5 -> 308d243e024c (BEHIND)
  Skills added upstream: context-budget
  Plugin description changed since install

[BEHIND] top10-scan (ordovera-plugins)
  Repo: ordovera/ordovera-plugins
  Installed: 2026-04-02 | Last updated: 2026-04-02
  SHA: 6c97949accf5 -> 308d243e024c (BEHIND)

[OK] mcp-audit (ordovera-plugins)
  Repo: ordovera/ordovera-plugins
  Installed: 2026-04-15 | Last updated: 2026-04-15
  SHA: 308d243e024c (CURRENT)

Summary
-------
  Behind upstream: context-setup, top10-scan
  Current: mcp-audit
```

## What this does NOT cover

cc-sc-verify checks the **plugin layer** -- the integrity of installed Claude Code plugins against their source repos. It does not:

- Audit plugin permissions or structure (use [plugin-audit](https://github.com/nicholasgasior/plugin-audit) or [claude-plugin-audit](https://www.npmjs.com/package/claude-plugin-audit))
- Audit Claude Code settings permissions (use [cc-audit](https://www.npmjs.com/package/cc-audit))
- Scan code dependencies for CVEs (use [npm audit](https://docs.npmjs.com/cli/commands/npm-audit), [pip-audit](https://pypi.org/project/pip-audit/), or the top10-scan plugin's SCA skill)
- Scan plugin skill content for malicious patterns (use security-guidance or Trail of Bits supply-chain skills)

The gap cc-sc-verify fills: every existing tool audits either structure/permissions of installed plugins OR code dependencies. Nobody verifies installed plugins against their source repos for tampering, version drift, repo deletion, or tool definition changes since install. That is the source integrity layer.

## How it works

1. Reads `~/.claude/plugins/installed_plugins.json` for installed plugin metadata (install path, version SHA, install date)
2. Reads `~/.claude/plugins/known_marketplaces.json` to map marketplace names to GitHub repos
3. For each plugin, calls the GitHub API to check repo status (exists, archived, transferred)
4. Fetches the repo tree to compare skills and hooks against the cached install
5. Compares the installed commit SHA against the latest upstream SHA

## Environment

- **GITHUB_TOKEN** -- Optional. GitHub personal access token for authenticated API access. Without it, you're limited to 60 requests per hour (enough for a few plugins). With it, 5,000 per hour.

## Sibling packages and plugins

- [cc-mcp-audit package](../cc-mcp-audit/) -- governance posture CLI for MCP servers
- [mcp-audit plugin](../../plugins/mcp-audit/) -- interpretive MCP governance analysis
- [context-setup plugin](../../plugins/context-setup/) -- context engineering and trust boundary documentation
- [top10-scan plugin](../../plugins/top10-scan/) -- OWASP Top 10 security scanning

## License

MIT
