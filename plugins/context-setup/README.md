# context-setup

A Claude Code plugin for scaffolding, auditing, aligning, optimizing MCP tools, and upgrading context engineering files. Generates AGENTS.md files, context directories, and cascading structures based on your project's actual stack and complexity.

Originally developed as part of [context-engineering](https://github.com/fending/context-engineering).

## Install

```bash
/plugin marketplace add ordovera/ordovera-plugins
/plugin install context-setup@ordovera-plugins
```

## Quick Start

1. `/context-setup:context-scaffold` -- generate AGENTS.md from your project
2. Review the output and fill in `[bracket]` placeholders with your knowledge
3. `/context-setup:context-audit` -- verify structure and completeness
4. `/context-setup:context-mcp` -- if you have MCP servers connected, get optimization guidance
5. Periodically: `/context-setup:context-align` for drift detection, `/context-setup:context-usage` mid-session for token diagnostics

## Updating

The plugin auto-updates when the source repo gets new commits. If your installed version seems stale (missing skills, old behavior):

1. Verify: check `~/.claude/plugins/cache/context-setup/context-setup/`. The directory name should be a git SHA (like `dea82eb8999f`), not a semver string (like `1.0.0`). If it's semver, you have the old cache format.

2. Fix: remove the stale cache and marketplace clone (`rm -rf ~/.claude/plugins/marketplaces/context-setup` and `rm -rf ~/.claude/plugins/cache/context-setup/context-setup/`), then reinstall with `/plugin install context-setup@ordovera-plugins`.
3. Verify after reinstall: the cache directory should now be a git SHA, and all 6 skills should be available.

## Skills

When no other installed plugin has a skill with the same name, Claude Code allows the short form -- `/context-scaffold` instead of `/context-setup:context-scaffold`. The full namespaced form always works.

### /context-setup:context-scaffold

Analyze your project and generate the right context files pre-populated with discovered information. Detects tech stack, framework, directory structure, and existing context. Recommends a complexity level (minimal, full single file, or cascading with context directory) and generates the corresponding files.

### /context-setup:context-audit

Evaluate your existing context structure for completeness and best practices. Checks whether your context complexity matches your project complexity, whether required sections are present, whether format conventions are followed, and whether structural issues exist (duplicated subdirectory files, empty context directory files, cascading contradictions).

### /context-setup:context-align

Cross-reference your context files against the actual codebase to find drift. Checks tech stack references against dependencies, directory paths against the filesystem, build commands against actual scripts, skill relevance against the current stack, and cascading contradictions across context levels.

### /context-setup:context-usage

Quick diagnostic of context consumption from Bash tool calls in the current session. Reports verbose commands, repeated invocations, and already-concise commands. Points to `/context-setup:context-audit` for specific optimization recommendations when opportunities are found. Works only with pre-compression session history.

### /context-setup:context-mcp

Detect connected MCP servers across platforms, match them against known optimization templates, and generate MCP Tool Notes for your AGENTS.md. For servers without known templates, interactively discover optimization opportunities by inspecting tool registries and optionally making test calls with user confirmation.

### /context-setup:context-upgrade

Guide a transition from your current context level to the next one. Preserves existing content while adding missing sections (minimal to full), extracting content into a context directory (full to cascading), or describing the skills and hooks layers you can add on top.

## Learning the Patterns

This plugin generates context files based on patterns documented in the [context-engineering](https://github.com/fending/context-engineering) repo. For the theory behind the structures, read the repo's examples and the companion article: [Rethinking Team Topologies for AI-Augmented Development](https://brianfending.substack.com/p/rethinking-team-topologies-for-ai).
