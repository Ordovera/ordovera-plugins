---
name: mcp-discover
description: Discover MCP server candidates from curated lists and GitHub search, producing a filtered candidates file for analysis.
---

# MCP Server Discovery

Find MCP server repositories for governance analysis. Parses curated lists (awesome-mcp-servers, official MCP servers list) and searches GitHub, then filters and deduplicates into a candidates file.

For analysis of discovered servers, use `/mcp-audit:mcp-audit`.

## Prerequisites

The `cc-mcp-audit` package must be available. Check with:

```bash
npx cc-mcp-audit --help
```

If not installed, it is available from the ordovera-plugins monorepo under `packages/cc-mcp-audit`. Build with `npm run build` from that directory, or install globally.

## Step 1: Determine Scope

Ask the user what they are looking for:

- **Broad survey**: All servers above a star threshold (default: 10)
- **Language-specific**: Filter to TypeScript, Python, or both
- **Targeted**: Specific curated list URLs or manual repo list
- **Update**: Refresh an existing candidates file with new entries

If the user provides repo URLs directly, skip discovery and go straight to `/mcp-audit:mcp-audit`.

## Step 2: Run Discovery

Build the command based on scope:

```bash
npx cc-mcp-audit discover \
  --min-stars <threshold> \
  --language <lang> \
  --output candidates.json
```

Common flag combinations:

- Broad: `--min-stars 10`
- Curated only (no GitHub API needed): `--skip-github`
- GitHub only (need token): `--skip-curated --github-token $GITHUB_TOKEN`
- Update existing: `--existing previous-candidates.json --output candidates.json`

If the GitHub API returns a rate limit error, inform the user:

> GitHub API rate limit reached. Options:
> 1. Provide a GitHub token via `--github-token` or `GITHUB_TOKEN` env var
> 2. Run with `--skip-github` to use only curated lists
> 3. Wait and retry

## Step 3: Review Candidates

After discovery completes, summarize the results:

- Total candidates found
- Breakdown by language
- Breakdown by source (curated-list vs github-search)
- Top 10 by stars

Ask the user if they want to:

1. **Proceed to analysis** with all candidates
2. **Filter further** (remove specific repos, narrow by language/stars)
3. **Save and review** the candidates file manually before analysis

## Step 4: Handoff to Analysis

If the user wants to proceed, invoke analysis:

```bash
npx cc-mcp-audit -c candidates.json --format json -o audit-report.json
```

Then follow up with `/mcp-audit:mcp-audit` for interpretive analysis of the results.

## Notes

- Discovery output uses the `CandidateFile` schema (version 0.1.0) which is directly consumable by the analysis command
- The `--existing` flag enables incremental discovery -- new candidates are added, existing ones are preserved
- GitHub token is optional for curated list parsing but required for enrichment (stars, dates, language metadata) and higher API rate limits
