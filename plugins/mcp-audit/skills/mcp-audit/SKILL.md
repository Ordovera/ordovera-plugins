---
name: mcp-audit
description: Analyze MCP servers for governance posture -- tool inventory, sensitivity, auth, logging, and confirmation gates with interpretive review.
---

# MCP Server Governance Audit

Analyze MCP server repositories for governance-relevant properties. Combines automated static analysis (via `cc-mcp-audit`) with interpretive review.

## Step 1: Check and Extract

Run the CLI against the user's input (URLs, local paths, or candidates file from `/mcp-audit:mcp-discover`):

```bash
npx cc-mcp-audit <source> --format json
```

For candidates files: `npx cc-mcp-audit -c <file> --format json`

For batches larger than 3 servers, write to file with `-o audit-raw.json`.

If `cc-mcp-audit` is not found, tell the user:

> `cc-mcp-audit` is not installed. From the ordovera-plugins repo, run:
> ```
> cd packages/cc-mcp-audit && npm install && npm run build
> ```
> Then re-run this skill.

## Step 2: Interpret

For each server, review the automated findings against these four dimensions. Read source files at the reported locations where the automated signal is ambiguous.

**Authorization**: The CLI flags `hasAuth` and `hasPerToolAuth` via keyword heuristics. Determine: is auth genuinely per-tool or global middleware? If no auth detected, does the server delegate to the transport layer (common in MCP)? "Unclear" means auth patterns appear in both tool files and separate modules -- read the code to resolve.

**Write Tool Guardrails**: For each tool classified as "write", check whether it has input validation, scope limits, dry-run modes, or confirmation parameters. Flag tools accepting arbitrary input (SQL, shell commands, file paths) as higher risk. Correct false positives from the classifier where "execute" appears in a read-only context.

**Confirmation Gates**: The CLI detects gate keywords (dry_run, confirm, approval, sandbox, preview) but cannot trace execution paths. Verify gates are functional, not just variable names. Determine whether gates default safe (opt-out) or unsafe (opt-in), and whether they cover all write tools.

**Accountability**: Assess audit trail from logging patterns. Can actions be attributed to a user/session? Is there rollback capability?

## Step 3: Present

Per server:

```
## [Server Name]
Source: [url] | Language: [lang]

### Tool Inventory
[Table: tool name, classification, sensitive keywords]

### Governance Posture
- **Authorization**: [Global / Per-tool / None / Delegated] -- [evidence]
- **Logging**: [Comprehensive / Partial / None] -- [what is/isn't logged]
- **Gates**: [Default-safe / Default-unsafe / Absent] -- [which tools are gated]
- **Accountability**: [Strong / Partial / Weak] -- [traceability assessment]

### Risk Summary
Sensitive tools: [N of M] | Ungated write tools: [list]
Key concern: [one sentence]
```

For multi-server reports, add a comparison table and patterns summary.

## Notes

- Servers showing `hasAuth: false` may delegate auth to the MCP transport layer -- not necessarily a gap
- "No tools extracted" warnings mean unsupported registration patterns -- read source manually to complete the inventory
- For large batches, offer markdown file output for inclusion in documents
