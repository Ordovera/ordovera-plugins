---
name: context-setup
description: Entry point for the context-setup plugin. Lists available context engineering skills and recommends where to start based on your project's current state.
---

# context-setup

You are the entry point for the context-setup context engineering plugin. Help the user understand what's available and route them to the right skill.

## When invoked without context

If the user just typed `/context-setup` with no additional instructions, check the current directory for existing context files:

```bash
ls -la AGENTS.md CLAUDE.md .claude/settings.json 2>/dev/null; ls -d .context/ context/ 2>/dev/null
```

Then respond based on what exists:

**If no AGENTS.md or CLAUDE.md exists:**

> No context files found. Here's where to start:
>
> 1. `/context-setup:context-scaffold` -- Analyze this project and generate context files pre-populated with discovered information
>
> After scaffolding, these skills refine your setup:

Then list the remaining skills below.

**If context files exist:**

> Found existing context files. Available skills:

Then list all skills.

Available skills:

- `/context-setup:context-scaffold` -- Analyze a project and generate AGENTS.md, context directory, and cascading structure. Best for bootstrapping a new project.
- `/context-setup:context-audit` -- Evaluate existing context files for completeness, level appropriateness, and best practices. Checks structure, not codebase accuracy.
- `/context-setup:context-align` -- Check context files against the actual codebase for drift. Surfaces stale references to packages, directories, commands, or patterns.
- `/context-setup:context-upgrade` -- Guide transition from one context level to the next (minimal to full, full to cascading, or adding skills/hooks layers).
- `/context-setup:context-mcp` -- Detect connected MCP servers and generate optimized MCP Tool Notes for your AGENTS.md.
- `/context-setup:context-usage` -- Report on token consumption from tool calls in the current session. Points to optimization opportunities.

Suggest this sequence for new projects:

1. `/context-setup:context-scaffold` to bootstrap context files
2. `/context-setup:context-audit` to check completeness
3. `/context-setup:context-align` to verify accuracy against the codebase

Suggest this sequence for existing projects with context:

1. `/context-setup:context-audit` to check structure and completeness
2. `/context-setup:context-align` to find drift
3. `/context-setup:context-upgrade` if the audit recommends a higher level

## When invoked with a request

If the user typed `/context-setup` followed by something that indicates what they want, route them to the matching skill:

- "scaffold", "bootstrap", "generate", "new project", "create", "init" -> `/context-setup:context-scaffold`
- "audit", "check", "review", "evaluate" -> `/context-setup:context-audit`
- "align", "drift", "stale", "outdated", "verify" -> `/context-setup:context-align`
- "upgrade", "level up", "next level", "cascading" -> `/context-setup:context-upgrade`
- "mcp", "tools", "servers", "tool notes" -> `/context-setup:context-mcp`
- "usage", "tokens", "cost", "consumption" -> `/context-setup:context-usage`

Tell the user which skill matches and ask: "Want me to run `/context-setup:[skill]` now?"

If the request is ambiguous (e.g., "fix my context"), ask whether they want an audit (structure check), alignment (codebase drift check), or both.

## When invoked in an empty directory

If the current directory has no source code or project files, tell the user:

> No project detected in the current directory. Navigate to a project root and try again, or specify a target directory.

## Key message

Context engineering is about giving Claude the right information at the right time. Well-structured context files reduce wasted tokens, prevent repeated mistakes, and make Claude more effective across conversations. Start with scaffold, refine with audit and align, and keep context current as the codebase evolves.
