# Changelog

## 2.0.0

`context-setup` is now a materially different plugin than the original `context-engineering` version it was ported from. This release marks the move into `github.com/ordovera/ordovera-plugins` and the point where the plugin stops being just a useful prompt bundle and becomes a more deliberate, test-backed product surface.

### Release Summary

- Move `context-setup` into the `ordovera/ordovera-plugins` marketplace repo and establish it as the maintained public home for future releases
- Expand the plugin from the original 4-skill core to a 6-skill workflow covering scaffold, audit, align, upgrade, MCP optimization, and session-usage diagnostics
- Add MCP-aware context generation and guidance, including template-backed MCP Tool Notes generation and audit cross-references
- Add command-output optimization guidance and session-observed token-usage diagnostics
- Add a public verification system with curated fixtures, expected results, golden baselines, and runnable verification scripts
- Strengthen public docs with sample output, validation guidance, known limits, and a clearer product philosophy
- Strengthen scaffold, audit, and align around trust boundaries, compaction-aware root context, and pragmatic `MEMORY.md` recognition while keeping `AGENTS.md` primary and `CLAUDE.md` as the compatibility surface
- Strengthen `context-upgrade` so upgrade paths preserve `AGENTS.md` primacy, introduce `operational-boundaries.md` when warranted, and reconcile optional `MEMORY.md` without promoting it to the primary artifact
- Improve packaging behavior by removing the plugin `version` field so installed copies follow git-SHA cache keys and pick up repo updates more reliably

### Highlights Since The Original Port

- `context-scaffold`
  - detects MCP config and trust-adjacent automation such as Claude hook settings
  - generates stronger root-entrypoint guidance for long-session survivability
  - recognizes existing `MEMORY.md` without treating it as the new primary artifact
- `context-audit`
  - checks for MCP coverage, command-output optimization opportunities, and trust-boundary gaps
  - flags overloaded root context and misuse of optional `MEMORY.md`
- `context-align`
  - checks drift across packages, paths, commands, MCP references, hook paths, and optional `MEMORY.md`
- Verification
  - adds `minimal-node-app`, `fullstack-app`, `stale-context-app`, and `memory-trust-app`
  - verifies scaffold, audit, and align contracts with golden baselines
- Docs and product polish
  - README now reflects trust surfaces, long-session context design, validation expectations, and limits
  - verification docs make the prompt-contract test surface public and reviewable

### Context

Trust-boundary framing and `MEMORY.md` guidance were informed in part by the Claude Code source leak reported on 31 March 2026. The leaked implementation details clarified how context loading, `CLAUDE.md` discovery, and memory-like patterns actually work under the hood. Rather than chase the speculative interpretations circulating in popular coverage, we extracted the durable workflow implications: `CLAUDE.md` remains a real onboarding primitive, context loading is selective rather than exhaustive, and `MEMORY.md` is useful as short-lived working memory but should not replace `AGENTS.md` as the durable policy surface.

### Upgrade Note

This is the first release that really reflects the plugin's post-port shape. If you used the earlier `context-engineering` version, expect broader scope, stronger MCP/trust-surface awareness, and a more opinionated verification story around the core workflow.

## 1.2.0

- Remove `version` field from plugin.json so cache keys use git SHA instead of semver -- reinstalls now pick up new commits automatically (matching the pattern used by official Anthropic plugins that auto-update). This is a VERY dumb hack to get auto-updates working, but with the micro-releases I'm doing this makes the most sense for this situation.

## 1.1.1

- Add MCP config detection to `/context-setup:context-scaffold` -- detects MCP servers during scaffolding and pre-populates MCP Tool Notes for known servers; unknown servers get a placeholder pointing to `/context-setup:context-mcp`
- Extend `/context-setup:context-usage` to observe MCP tool calls alongside Bash -- flags default-parameter MCP calls, estimates token savings, hands off to `/context-setup:context-mcp` for MCP-specific recommendations
- Fix context-audit category numbering reference (category 6 -> 7 for command output optimization after MCP cross-reference insertion)

## 1.1.0

- Add `/context-setup:context-mcp` skill -- detects connected MCP servers, matches against known optimization templates (Atlassian, Gmail, Google Calendar, Web, GitHub, Supabase, Vercel), generates MCP Tool Notes for AGENTS.md, and interactively discovers optimization opportunities for unknown servers
- Add `/context-setup:context-usage` skill -- reports on token consumption from Bash tool calls in the current session, flags verbose and repeated commands, estimates recoverable tokens
- Add MCP Tool Notes cross-reference to `/context-setup:context-audit` (category 6) -- detects MCP configs without corresponding MCP Tool Notes section
- Fix skill invocation names across all files -- use full namespaced form (`/context-setup:context-scaffold` not `/context-setup:scaffold`) for consistency and to avoid ambiguity with other plugins
- Document short-form invocation behavior in README (`/context-scaffold` works when no namespace conflict exists)

## 1.0.0

- Initial release with 4 skills: context-scaffold, context-audit, context-align, context-upgrade
