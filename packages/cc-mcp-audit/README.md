# cc-mcp-audit

Governance posture analysis for MCP servers. Extracts tool inventories, classifies read/write behavior and sensitivity, detects auth/logging/gate patterns, and surfaces named accountability gaps. Measures enforcement and audit concerns from the XACML/ABAC architecture against MCP server source code.

Does not detect code-level vulnerabilities -- pair with SAST and dependency scanning for deployment decisions.

## Install

```bash
npx cc-mcp-audit <github-url-or-local-path> --format json
```

Or install globally:

```bash
npm install -g cc-mcp-audit
```

## Usage

```bash
# Analyze a single server by GitHub URL
cc-mcp-audit https://github.com/org/mcp-server --format json

# Analyze a local directory
cc-mcp-audit ./path/to/server --format json

# Analyze from a candidates file
cc-mcp-audit -c candidates.json --format json

# Evidence envelope format (XACML-shaped output)
cc-mcp-audit -c candidates.json --format evidence -o evidence.json

# Markdown report
cc-mcp-audit -c candidates.json --format markdown

# With LLM screening for Domain 5 triage hints
cc-mcp-audit https://github.com/org/mcp-server --llm-screen

# Discover MCP server candidates (curated lists + GitHub search)
cc-mcp-audit discover --min-stars 50 -o candidates.json
```

## What It Checks

### Two-axis tool classification

Each extracted tool is classified on two orthogonal axes:

- **Read/write** (persistent-effect): does calling this tool change persistent state? Validated at kappa=0.940 (LLM vs human).
- **Sensitivity** (governance-relevance): does this tool affect confidentiality, integrity, availability, autonomy, or accountability? Validated at kappa=0.833 (deterministic vs human). Boundary-aware keyword matching prevents false positives.

### Seven accountability gap patterns

| Pattern | Confidence | What It Means |
|---|---|---|
| ungated-write | High | Write tools with no confirmation gate co-located |
| global-auth-over-sensitive-tools | High/Low | Uniform auth across tools with different sensitivity |
| auth-without-actor-logging | High | Auth present but log statements lack principal identifiers |
| logging-without-attribution | Medium | Logging present but no principal identifiers and no auth |
| destructive-without-audit-trail | High | Irreversible operations (drop, delete, truncate) with no logging |
| sensitive-read-without-auth | High | Sensitive data exposed with no authentication |
| sensitive-read-without-logging | High | Sensitive data access with no audit trail |

### Governance indicators (14 three-valued)

Each indicator is coded Present / Absent / Indeterminate:

- **Enforcement (PEP)**: authentication, perToolAuth, confirmationGates, stagedExecution, rateLimiting, leastPrivilege, sensitiveReadProtection
- **Audit (NIST 800-162 S5.7)**: auditLogging, actorAttribution
- **Design**: readWriteSeparation, sensitiveCapabilityIsolation
- **Domain 5 (human-only)**: selfModificationPrevention, subAgentAuthorityConstraints, permissionBoundaryEnforcement

## Canonical Discovery

The `discover-registry` module enumerates MCP servers from three canonical registries:

- **MCP Registry** (registry.modelcontextprotocol.io) -- paginated API, 25K+ entries
- **npm** -- keyword search for mcp-server packages
- **PyPI** -- simple index search for mcp packages

Produces a canonical snapshot with provenance tags, deduplication by repository URL, and transport/ecosystem metadata. The `sampler` module draws stratified random samples with seeded PRNG for reproducibility.

## LLM Verification

The `verify` module runs per-server LLM verification using Claude Opus:

1. MCP server confirmation (is this actually an MCP server?)
2. Supplementary tool extraction (tools the heuristic missed)
3. Classification validation (read/write rationale with source citations)

Context extraction prioritizes dependency manifests, MCP-importing files, and entry points within a ~30K token budget.

## LLM Screening

Optional `--llm-screen` adds Domain 5 triage hints:

- Self-modification prevention
- Sub-agent authority constraints
- Permission boundary enforcement

Hints are `likely-present`, `likely-absent`, or `unclear` with cited file:line locations. They prioritize human review order -- they are not findings.

## Environment

- **GITHUB_TOKEN** -- GitHub personal access token for discovery and higher API rate limits
- **ANTHROPIC_API_KEY** -- Required for `--llm-screen` or `--llm-verify` if Claude Code CLI is not on PATH

## License

MIT
