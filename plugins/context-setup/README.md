# context-setup

A Claude Code plugin for scaffolding, auditing, aligning, optimizing MCP tools, and upgrading context engineering files. Generates `AGENTS.md` files, `CLAUDE.md` compatibility entrypoints, and cascading structures based on your project's actual stack, trust surfaces, and complexity.

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
6. Revisit root context after adding hooks, MCP servers, or long-lived workflows so trust boundaries and compaction-safe guidance stay current

## Philosophy

- `AGENTS.md` is the primary artifact.
- `CLAUDE.md` is the compatibility surface and should point at `AGENTS.md`, not fork away from it.
- `context/` holds reference assets (architecture, methodology, requirements) -- loaded by whatever needs them, not Claude Code-specific.
- `.claude/rules/` holds path-specific coding instructions with `paths:` frontmatter -- auto-loaded by Claude Code when working with matching files, survives compaction.
- Do not create project-root `MEMORY.md` files. Claude Code has a built-in auto memory system at `~/.claude/projects/<project>/memory/` that Claude manages automatically -- saving corrections, preferences, and insights across sessions. A manually created project-root MEMORY.md conflicts with this system. If one is found, the plugin flags it for removal and helps migrate durable content into `AGENTS.md` or `context/` files.
- Hook config, MCP config, and other operator-owned automation are part of the context trust boundary and should be documented clearly enough that agents know what they may rely on and what they should treat carefully.
- The trust-boundary and `MEMORY.md` positions in v2.0.0 were informed by the Claude Code source leak of 31 March 2026 -- specifically, by what the extracted code actually shows about context loading and memory patterns, rather than by the speculative framing in popular coverage.

## Sample Output

Example `context-scaffold` outcome for a small TypeScript app:

```text
Recommendation: minimal
Creates:
- AGENTS.md
- CLAUDE.md -> AGENTS.md

Key sections:
- Tech Stack
- Commands
- Code Standards
- Do NOT
```

Example `context-audit` outcome for a project with stale context:

```text
Context Audit Results

Level Appropriateness: Partial
Format and Conventions: Partial
Structural Issues: Partial

Priority recommendations:
1. Fix stale command references
2. Repair CLAUDE.md symlink behavior
3. Replace contradictory subdirectory guidance
```

Example `context-align` outcome:

```text
Found drift:
- AGENTS.md references React 18 but package.json shows React 19
- AGENTS.md references src/lib/auth/ but the path does not exist
- architecture-decisions.md references npm run test:api but that script does not exist
```

Example trust-boundary guidance that `context-scaffold` should encourage for more advanced setups:

```text
Trust Boundary Notes
- MCP server selection and credentials are operator-owned; use configured servers, but do not add or change them without approval.
- Repository hooks may block or rewrite work. Check documented hook behavior before bypassing validation.
- Keep root AGENTS.md stable and move volatile migration notes into context/ files so guidance survives compaction.
```

## Updating

The plugin auto-updates when the source repo gets new commits. If your installed version seems stale (missing skills, old behavior):

1. Verify: check `~/.claude/plugins/cache/context-setup/context-setup/`. The directory name should be a git SHA (like `dea82eb8999f`), not a semver string (like `1.0.0`). If it's semver, you have the old cache format.

2. Fix: remove the stale cache and marketplace clone (`rm -rf ~/.claude/plugins/marketplaces/context-setup` and `rm -rf ~/.claude/plugins/cache/context-setup/context-setup/`), then reinstall with `/plugin install context-setup@ordovera-plugins`.
3. Verify after reinstall: the cache directory should now be a git SHA, and all 8 skills should be available.

## Skills

When no other installed plugin has a skill with the same name, Claude Code allows the short form -- `/context-scaffold` instead of `/context-setup:context-scaffold`. The full namespaced form always works.

### /context-setup:context-scaffold

Analyze your project and generate the right context files pre-populated with discovered information. Detects tech stack, framework, directory structure, existing context, and trust-adjacent surfaces such as MCP config and hook config. Recommends a complexity level (minimal, full single file, or cascading with context directory) and generates the corresponding files.

### /context-setup:context-audit

Evaluate your existing context structure for completeness and best practices. Checks whether your context complexity matches your project complexity, whether required sections are present, whether format conventions are followed, whether trust-boundary surfaces are acknowledged, and whether structural issues exist (duplicated subdirectory files, empty context directory files, cascading contradictions, overloaded root files, misused `MEMORY.md` files).

### /context-setup:context-align

Cross-reference your context files against the actual codebase to find drift. Checks tech stack references against dependencies, directory paths against the filesystem, build commands against actual scripts, hook and MCP references against actual config, `MEMORY.md` references when present, skill relevance against the current stack, and cascading contradictions across context levels.

### /context-setup:context-usage

Quick diagnostic of context consumption from Bash tool calls in the current session. Reports verbose commands, repeated invocations, and already-concise commands. Points to `/context-setup:context-audit` for specific optimization recommendations when opportunities are found. Works only with pre-compression session history.

### /context-setup:context-mcp

Detect connected MCP servers across platforms, match them against known optimization templates, and generate MCP Tool Notes for your AGENTS.md. For servers without known templates, interactively discover optimization opportunities by inspecting tool registries and optionally making test calls with user confirmation.

### /context-setup:context-upgrade

Guide a transition from your current context level to the next one. Preserves existing content while adding missing sections (minimal to full), extracting content into a context directory (full to cascading), or describing the skills and hooks layers you can add on top.

## Validate Output

After generating or updating context:

1. Review every `[bracket]` placeholder and replace the ones that require project knowledge.
2. Run `/context-setup:context-audit` to check structural completeness.
3. Run `/context-setup:context-align` to catch stale paths, dependencies, or commands.
4. Review `Do NOT` boundaries manually before relying on them.
5. If the project uses MCP servers, hooks, or a `MEMORY.md`, confirm the generated guidance reflects those trust and durability concerns explicitly.

For contributors working on the plugin itself, see [`docs/verification.md`](docs/verification.md).

## Known Limits

- Placeholders are intentional. The plugin prefers an explicit gap over confidently inventing project-specific details.
- Generated architecture, auth, and workflow prose may still need human correction.
- `context-audit` checks structure and completeness, not whether architectural descriptions are true.
- `context-align` checks references against the repo, not whether business intent is still correct.
- Trust-boundary guidance is deliberately lightweight. The plugin can surface MCP, hook, and automation surfaces, but the operator still decides which tools or permissions are acceptable.
- `context-usage` depends on visible session history and is less useful after history compression.
- `context-mcp` includes both deterministic template matching and best-effort guidance for unknown servers.

## References

Official Claude Code documentation that informs this plugin's design:

- [How Claude remembers your project](https://code.claude.com/docs/en/memory) -- CLAUDE.md files, `.claude/rules/`, auto memory, `@import` syntax, compaction behavior, instruction hierarchy
- [Skills](https://code.claude.com/docs/en/skills) -- how SKILL.md files work, when to use skills vs rules vs CLAUDE.md
- [Hooks](https://code.claude.com/docs/en/hooks) -- hook events (PreToolUse, PostToolUse), `InstructionsLoaded` hook for debugging which files load
- [Context window](https://code.claude.com/docs/en/context-window) -- what survives compaction, context visualization, token budget
- [Settings](https://code.claude.com/docs/en/settings) -- `claudeMdExcludes`, `autoMemoryEnabled`, managed settings, settings layers
- [Debug your configuration](https://code.claude.com/docs/en/debug-your-config) -- diagnosing why CLAUDE.md or settings aren't taking effect

Sibling plugins and packages in this repo:

- [top10-scan plugin](../top10-scan/) -- OWASP Top 10 security scanning
- [mcp-audit plugin](../mcp-audit/) -- MCP server governance posture analysis
- [cc-sc-verify package](../../packages/cc-sc-verify/) -- supply chain integrity checker for installed plugins (`npx cc-sc-verify`)
- [cc-mcp-audit package](../../packages/cc-mcp-audit/) -- governance posture CLI that powers the mcp-audit plugin (`npx cc-mcp-audit`)

Related resources:

- [context-engineering](https://github.com/fending/context-engineering) -- patterns and examples this plugin implements
- [Rethinking Team Topologies for AI-Augmented Development](https://brianfending.substack.com/p/rethinking-team-topologies-for-ai) -- theory behind the context structures

## Disclaimer

This software is provided as-is, without warranty of any kind. The authors and contributors are not liable for any damages or losses arising from its use. Generated files should be reviewed before committing to your project.
