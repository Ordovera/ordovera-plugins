---
name: context-budget
description: Estimates how much of the context window is consumed before you type anything. Breaks down CLAUDE.md files, skills, MCP tool descriptions, auto-memory, and hooks. Diagnoses context pressure from plugin sprawl.
---

# Context Budget

Pre-session diagnostic that estimates how much of the context window is already consumed by static context: the files, skills, tool descriptions, and memory that load before your first message. Answers: "why is Claude getting worse after I installed 20 plugins?"

## What This Skill Does

Measure and report the token cost of everything that loads into context at session start. This is a read-only diagnostic; it changes nothing, installs nothing.

### 1. Measure CLAUDE.md Chain

Read all CLAUDE.md and AGENTS.md files that would load at session start:

- `~/.claude/CLAUDE.md` (user-level global instructions) - ask before reading
- Project-root CLAUDE.md or AGENTS.md (whichever exists)
- Subdirectory CLAUDE.md files referenced by the root file or discovered in immediate child directories

For each file:
- Count lines and estimate tokens (~3 tokens per line as baseline, ~4 for dense instruction files with tables/code blocks)
- Note if the file is a symlink (e.g., CLAUDE.md -> AGENTS.md)

### 2. Measure Installed Skills

List all skills currently loaded from installed plugins. For each skill:

- Skill name and source plugin
- SKILL.md line count and estimated token cost
- Whether the skill appears in conversation context (skills load their SKILL.md when invoked, but skill *descriptions* from plugin.json and frontmatter load at session start)

Note: Full SKILL.md content loads only when a skill is invoked. The pre-session cost is the skill registry -- name + description per skill. Estimate ~20 tokens per registered skill for the registry overhead.

### 3. Measure MCP Tool Descriptions

Enumerate MCP servers and their registered tools. For each server:

- Server name and transport type
- Number of tools registered
- Estimated token cost of tool descriptions (~30 tokens per tool for name + description + parameter schema, more for tools with complex schemas)

Source configs: same detection paths as context-mcp (`.mcp.json`, `~/.claude/settings.json`, `.vscode/mcp.json`, `.cursor/mcp.json`). Ask before reading user-level configs.

### 4. Measure Auto-Memory

Check for auto-memory at `~/.claude/projects/*/memory/`:

- Count memory files
- Estimate MEMORY.md index size (~3 tokens per line)
- Note: individual memory files load on demand, but MEMORY.md index loads at session start

Ask before reading memory paths outside the current project.

### 5. Measure Hooks

Check for hook configurations in `.claude/settings.json` (project-level) and `~/.claude/settings.json` (user-level):

- Count hook definitions
- Hooks don't consume context tokens directly, but hook *output* injected via `<user-prompt-submit-hook>` does. Note this distinction.

### 6. Generate Budget Report

Present a single summary table:

```text
Context Budget | Pre-Session Estimate

Component                    | Lines | Est. Tokens | % of 200K
-----------------------------|-------|-------------|----------
CLAUDE.md chain (N files)    |   XXX |       X,XXX |      X.X%
Skill registry (N skills)    |     - |         XXX |      X.X%
MCP tool descriptions (N)    |     - |       X,XXX |      X.X%
Auto-memory index            |    XX |         XXX |      X.X%
-----------------------------|-------|-------------|----------
Total pre-session            |       |       X,XXX |      X.X%
Remaining for conversation   |       |     XXX,XXX |     XX.X%
```

Use 200,000 tokens as the reference context window size. Note that actual available context depends on the model and may differ.

### 7. Diagnosis

After the table, provide targeted observations:

**If total pre-session > 10% of context:**
> WARNING: Pre-session context consumes more than 10% of the window. This reduces effective conversation length and may cause earlier compression. Consider auditing which plugins and MCP servers are necessary for this project.

**If MCP tool descriptions > 5% of context:**
> MCP tool descriptions are the largest pre-session cost. Each connected server registers all its tools regardless of whether you use them. Consider disconnecting servers not needed for this project, or using project-scoped `.mcp.json` instead of user-level config.

**If skill registry > 3% of context:**
> You have [N] skills registered from [M] plugins. Each skill's description loads at session start. Consider uninstalling plugins you don't use regularly in this project.

**If CLAUDE.md chain > 5% of context:**
> Your CLAUDE.md files are large. Run `/context-setup:context-audit` to check for redundancy or content that could move to a `context/` directory (loaded on demand instead of at session start).

**If nothing notable:**
> Context budget is healthy. Pre-session consumption is well within normal range.

## When to Use

- After installing several plugins, when responses feel degraded
- When starting work on a project with many MCP integrations
- As a baseline check before a long coding session
- When comparing context efficiency between two project setups

## How This Differs from Other Skills

- **context-budget** (this skill) measures what loads *before* you type. Static, pre-session cost.
- **context-usage** measures what happens *during* a session. Dynamic, tool-call cost.
- **context-audit** checks structural quality of your context files and suggests improvements.
- **context-mcp** optimizes MCP tool *usage* (parameter knobs, output reduction). This skill measures MCP tool *registration* cost (how much the descriptions themselves consume).

Use context-budget to understand your starting position. Use context-usage mid-session to understand runtime consumption. Use context-audit and context-mcp to act on the findings.

## Notes

Token estimates are approximate. The ~3 tokens/line baseline is directionally correct for prose and structured text. Dense JSON schemas (common in MCP tool descriptions) may be higher. The goal is order-of-magnitude awareness ("MCP tools cost 8,000 tokens" vs. "MCP tools cost 800 tokens"), not exact measurement.

The 200K reference window is based on current Claude model defaults. If the model context changes, the percentages adjust but the absolute token counts remain the diagnostic signal.

This skill cannot measure system prompt tokens injected by the Claude Code framework itself (tool definitions, system instructions). Those are outside the plugin's visibility. The budget reported here is the user-controllable portion of pre-session context.
