# AGENTS.md

Claude Code plugin monorepo. Two plugins ship from this repo: `context-setup` (context engineering) and `top10-scan` (OWASP security scanning).

## Tech Stack

- Claude Code plugin system (`.claude-plugin/plugin.json` + `skills/*/SKILL.md`)
- Python 3 (stdlib only) for all scripts and verification harnesses
- Bash for shell script wrappers and hooks
- JSON for structured data, assertions, expected results, and config

No build step. No package manager at the repo root. Each plugin is self-contained.

## Repo Structure

```text
ordovera-plugins/
  .claude-plugin/marketplace.json  -- Plugin registry (lists both plugins)
  .gitignore                       -- Ignores context/ (private planning docs) and .DS_Store
  README.md                        -- Public-facing install instructions
  AGENTS.md                        -- This file
  CLAUDE.md                        -- Symlink to AGENTS.md
  context/                         -- Private planning docs (gitignored, not shipped)
  plugins/
    context-setup/                 -- Context engineering plugin (6 skills)
    top10-scan/                    -- OWASP security scanning plugin (7 skills)
```

## Plugin Structure Pattern

Both plugins follow the same layout:

```text
plugins/<name>/
  .claude-plugin/plugin.json  -- Minimal metadata (name, description, author, no version)
  skills/*/SKILL.md           -- One SKILL.md per skill (the prompt/orchestration logic)
  data/                       -- Structured JSON referenced by skills (testable independently)
  scripts/                    -- Python/bash verification and helper scripts
  hooks/                      -- Claude Code hook implementations (context-setup only)
  test-fixtures/              -- Curated project fixtures for verification
  expected-results/           -- Golden baselines and live assertions
  docs/                       -- Verification docs, contributor guides
  templates/                  -- Report templates (top10-scan only)
  owasp-cache/                -- OWASP Top 10 mappings and review prompts (top10-scan only)
  README.md                   -- Plugin-specific install, usage, skills reference
  CHANGELOG.md                -- Versioned change history
  LICENSE                     -- MIT
```

## Commands

Verification (context-setup):

- `bash plugins/context-setup/scripts/verify-context-setup.sh` -- Contract + golden baseline verification
- `python3 plugins/context-setup/scripts/verify-context-setup-live.py <dir> <assertions>` -- Live output verification
- `bash plugins/context-setup/hooks/test-hooks.sh` -- Hook implementation tests (18 tests)

Verification (top10-scan):

- `bash plugins/top10-scan/scripts/verify-top10-scan.sh` -- Contract + live verification
- `python3 plugins/top10-scan/scripts/verify-top10-scan.py --mode contract` -- Contract only (fixtures, baselines, framework detection, OWASP cache)
- `python3 plugins/top10-scan/scripts/verify-top10-scan.py --mode live` -- Live design review verification

## Code Standards

- Python: stdlib only, no external dependencies. argparse for CLIs. JSON to stdout, errors to stderr.
- Bash: `set -euo pipefail`. Graceful degradation (exit 0 with error JSON, not exit 1).
- JSON data files: include `schema_version` for forward compatibility.
- SKILL.md files: YAML frontmatter (name, description), H1 title, structured sections. Reference data files with `<plugin_dir>/data/` paths.
- No emojis in any file. No decorative symbols in documentation.
- 2-space indentation in JSON. Standard indentation in Python/Bash.

## How Plugins Work

Each plugin is installed independently via the Claude Code plugin system. Skills are SKILL.md files that contain prompt engineering -- they tell Claude what to do step by step. There is no compiled code; the SKILL.md IS the implementation.

Structured data (detection markers, OWASP mappings, MCP templates, audit categories) is extracted into JSON files under `data/` so it can be tested independently of the prompts.

Scripts under `scripts/` are helpers that skills invoke via bash commands. All scripts follow the contract: JSON stdout, errors stderr, exit 0 on success including graceful degradation.

## Verification Model

context-setup has three verification layers:

1. **Contract** -- Fixtures and golden baselines are self-consistent
2. **Golden** -- Expected results match intended schemas
3. **Live** -- Real scaffold runs produce outputs that satisfy structured assertions (scaffold only, 2 fixtures)

top10-scan has two verification layers:

1. **Contract** -- 7 fixtures contain documented vulnerabilities, 7 baselines are structurally valid, framework detection returns correct results for all fixtures, OWASP cache is internally consistent (10 categories, 9 framework hints each, CWE overlap within bounds)
2. **Live** -- Real design review runs against vulnerable-nextjs and vulnerable-fastapi produce findings that satisfy minimum count, required categories, and required semantic signals

## Do NOT

- Do not add `version` to `plugin.json` -- git SHA caching handles auto-updates
- Do not add external dependencies to Python scripts -- stdlib only
- Do not put documentation in plugin subdirectories other than README.md, CHANGELOG.md, and docs/
- Do not commit anything from `context/` -- it is gitignored private planning material
- Do not modify test fixtures to "fix" intentional issues -- stale references, contradictions, and misused files are the test cases
- Do not add new skills without corresponding test fixtures and expected results
- Do not merge prompt changes without running verification suites first
