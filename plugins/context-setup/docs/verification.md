# Verification

`context-setup` has two verification layers: a contract/golden layer that validates fixture integrity and baseline consistency without executing skills, and a live layer that validates real scaffold outputs against structured assertions.

## Layer 1: Contract and Golden Verification

This layer verifies that the test infrastructure itself is sound. It does **not** execute Claude skills or validate generated output. It checks:

1. Curated fixtures still represent the project shapes the plugin is expected to handle
2. Stored expected-results files are present and structurally complete
3. The stale-context fixture still contains the exact drift and audit scenarios we want to catch
4. Scaffold, audit, and align golden baselines remain structurally consistent

"Contract/golden verification passing" means the test suite is internally consistent -- fixtures have their intended signals, baselines have their intended assertions, and nothing has been accidentally broken.

Run the full suite:

```bash
bash plugins/context-setup/scripts/verify-context-setup.sh
```

Run a single fixture:

```bash
python3 plugins/context-setup/scripts/verify-context-setup.py --fixture stale-context-app
```

Run only golden verification:

```bash
python3 plugins/context-setup/scripts/verify-context-setup.py --mode golden
```

## Layer 2: Live Output Verification

This layer validates generated outputs from real scaffold runs against structured assertions. It proves that Claude produces correct output when executing the skill -- not just that the test infrastructure is self-consistent.

Live verification currently covers `context-scaffold` on two fixtures:

- `minimal-node-app` -- Asserts minimal recommendation (no over-engineering), correct headings, no MCP/trust sections, TypeScript/vitest/eslint signals
- `memory-trust-app` -- Asserts full_single_file recommendation, MCP Tool Notes and Trust Boundary Notes present, operator-owned/sentry/hooks signals, volatile notes excluded, MEMORY.md acknowledged as short-lived

Each assertion file uses three assertion classes:

- **Exact**: file existence, symlink status, recommendation class (inferred from output shape -- line count, heading count, presence of scaffold-generated context/ files)
- **Structural**: required/forbidden headings, line count envelope
- **Semantic**: required/forbidden substrings for content signals

### How to run

Live verification requires a working directory with generated outputs. The workflow is:

1. Copy a fixture to a temp directory
2. Run `context-scaffold` against it (via Claude Code)
3. Validate the output:

```bash
python3 plugins/context-setup/scripts/verify-context-setup-live.py \
  <working_dir> \
  plugins/context-setup/expected-results/<fixture>/scaffold-live/assertions.json
```

### Assertion files

Live assertions live under `expected-results/<fixture>/scaffold-live/assertions.json`, alongside but separate from the contract/golden baselines.

## Fixture Suite

Fixtures live under `test-fixtures/`:

- `minimal-node-app/` -- small single-package TypeScript app for minimal scaffold recommendations
- `fullstack-app/` -- single deployable full-stack app with API, auth, and data-model signals
- `stale-context-app/` -- project with intentionally stale and contradictory context files for audit and align verification
- `memory-trust-app/` -- project with MCP config, hook config, and an intentionally overused `MEMORY.md` for trust-boundary and long-session verification

Expected results live under `expected-results/`.

Golden baselines exist for:

- Scaffold: `minimal-node-app`, `fullstack-app`, `memory-trust-app`
- Audit: `stale-context-app`, `memory-trust-app`
- Align: `stale-context-app`, `memory-trust-app`
- Upgrade: `memory-trust-app`

## What Counts As A Regression

Examples of meaningful regressions:

- A fixture no longer contains the project signals it is meant to model
- A stale-context scenario is accidentally "fixed", weakening align/audit coverage
- Expected-results files are missing or structurally incomplete
- A scaffold golden baseline loses a required heading or starts including forbidden sections
- An audit golden baseline loses a required finding or category status
- An align golden baseline loses an expected drift signal
- A trust-boundary fixture stops modeling MCP, hook, or `MEMORY.md` misuse
- A live scaffold run fails recommendation, structural, or semantic assertions

Examples of changes that are **not** automatically covered:

- Harmless wording changes in generated prose
- Ranking shifts in recommendations that still satisfy the same scenario contract
- Stylistic prompt refinements that do not affect expected structural behavior
- Audit, align, and upgrade output quality (live verification covers scaffold only so far)

## How To Use This When Changing Prompts

For substantial skill changes:

1. Run the contract/golden suite
2. Run live scaffold verification on `minimal-node-app` and `memory-trust-app`
3. Review any fixture or expected-results changes carefully
4. Confirm the change preserves the intended behavior
5. Update this documentation if the verification model changes

## Current Limitations

The verification model does not yet:

- Cover `context-audit`, `context-align`, or `context-upgrade` with live output verification
- Cover `context-mcp` or `context-usage` with any verification layer
- Automate the Claude Code invocation step (live scaffold runs are currently manual)

Those are planned follow-on steps.
