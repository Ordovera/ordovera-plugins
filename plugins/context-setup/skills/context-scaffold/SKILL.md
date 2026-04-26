---
name: context-scaffold
description: Analyzes an existing project and generates context files (AGENTS.md, context directory, cascading structure) pre-populated with discovered information. Run once to bootstrap, then customize.
---

# Context Scaffold

Analyze your project and generate the right context files pre-populated with what can be auto-detected. Sections that require human input get bracket placeholders.

## Reference Data

Detection markers, complexity levels, and section specifications are defined in structured data files under `<plugin_dir>/data/`. See `detection-markers.json` and `complexity-levels.json` for the authoritative definitions. The instructions below describe how to apply them.

## What This Skill Does

1. **Discover project state:**
   - Read `package.json` / `requirements.txt` / `go.mod` / `Cargo.toml` / `pyproject.toml` for tech stack and available scripts/commands
   - Scan directory structure (top two levels) for project layout
   - Detect framework indicators: `next.config.*`, `vite.config.*`, `tsconfig.json`, `angular.json`, `webpack.config.*`, `tailwind.config.*`, `prisma/`, `.env*`
   - Check for existing context files: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `context/` directory
   - Check for `.claude/` directory (existing skills, hooks, settings)
   - Identify testing setup: test runner config, test directories, test scripts
   - Detect multiple backing services: count distinct service client packages (e.g., supabase + jira, prisma + stripe, aws-sdk + firebase). If 2+ detected, flag for Integration Map section.
   - Detect MCP server configs: check `.mcp.json`, `.vscode/mcp.json`, `.cursor/mcp.json`, `.codex/config.toml`, `.gemini/settings.json` at the project level. Match detected servers against known templates (Atlassian, Gmail, Google Calendar, Web, GitHub, Supabase, Vercel). If any are found, include an MCP Tool Notes section in the generated output.
   - Detect trust-adjacent automation: `.claude/settings.json`, `.claude/hooks/`, referenced hook scripts, and equivalent operator-owned config. If found, generate a lightweight trust-boundary section or placeholder rather than treating these files as invisible implementation detail.
   - Detect project-root `MEMORY.md` if present. This is NOT the same as Claude Code's built-in auto memory (which lives at `~/.claude/projects/<project>/memory/` and is written by Claude automatically). A project-root MEMORY.md is a user-created file that should not exist -- it duplicates or conflicts with the built-in system. If found, recommend removing it and migrating any durable content into AGENTS.md or context/ files.

2. **Determine complexity level.** Present a recommendation with rationale, let the user choose:
   - **Minimal** (~40 lines): Solo project, single language, straightforward structure. One deployment target, no auth layer, no multi-service architecture.
   - **Full single file** (~100-120 lines): Multi-layer app (frontend + backend), auth system, database, API with conventions worth documenting. Multiple backing services (database + external APIs). Still a single deployable unit. Also appropriate when the project has meaningful trust surfaces (MCP, hooks, operator-owned automation) but not enough architectural depth to warrant a `context/` split.
   - **Cascading + context directory**: Multiple projects or workspaces, team environment, complex architecture with distinct subsystems. Or a single project large enough that a single file would exceed ~150 lines. Prefer this level when the root file is at risk of becoming a dump of volatile migration notes, current-session context, or operational detail that should instead live in subordinate files.

3. **Generate files** based on the chosen level (templates below).

4. **Post-generation:**
   - Create `CLAUDE.md` symlink: `ln -s AGENTS.md CLAUDE.md`
   - List what was created
   - Highlight sections with bracket placeholders that need human review
   - Mention `CLAUDE.local.md`: "For personal project-specific preferences (sandbox URLs, preferred test data, local dev overrides), create `CLAUDE.local.md` in the project root. It loads alongside CLAUDE.md but is gitignored -- your personal settings won't affect teammates."
   - If a project-root `MEMORY.md` exists, flag it: this file conflicts with Claude Code's built-in auto memory system. Recommend removing it and migrating any durable content (architecture, policy, conventions) into AGENTS.md or context/ files. Claude Code manages its own memory at `~/.claude/projects/<project>/memory/` -- users should not create MEMORY.md manually.

## Templates

### Minimal (~40 lines)

Generate a single `AGENTS.md` with these sections. Populate from discovered information where possible; use bracket placeholders for anything that can't be auto-detected.

```markdown
# AGENTS.md

[One-sentence description of what this project does and who it's for.]

## Tech Stack

[List discovered from package manager config. Format as a flat list: runtime, framework, key libraries, database, deployment target.]

## Commands

[List discovered from package.json scripts, Makefile targets, or equivalent. Include only commands a developer would actually run -- dev, build, test, lint, deploy. Use the exact command syntax.]

## MCP Tool Notes

[Generate this section only if MCP server configs were detected during discovery. Include the CLI-first preamble: "When a CLI tool and MCP server both cover the same operation, prefer CLI for reads -- CLI generally offers field selection, output piping, and documented behavior that MCP servers typically lack." For each detected server that matches a known template, include the pre-populated entry. For detected servers without a known template, include a placeholder with a pointer to `/context-setup:context-mcp` for interactive discovery. If no MCP configs were detected, skip this section entirely.]

[Known server entries to use when matched -- see `/context-setup:context-mcp` SKILL.md for the full template text for each server family: Atlassian, Gmail, Google Calendar, Web, GitHub, Supabase, Vercel.]

[For unknown servers:]
- **[server name]** -- [run `/context-setup:context-mcp` for optimization recommendations for this server]

## Trust Boundary Notes

[Generate this section when trust-adjacent automation is detected: MCP config, Claude hook settings, hook scripts, or similar operator-owned tooling.]

- [Document which automation surfaces exist and where they are configured.]
- [State that these surfaces are operator-owned and should not be changed casually without approval.]
- [Explain any known expectations about how agents should use configured tools or hooks.]

[If MCP or hooks are present but details cannot be inferred safely, use a placeholder such as:]
- [Document your trust boundary here: which MCP servers, hooks, or local automation agents may rely on, and which of those should not be changed without approval.]

## Code Standards

[Infer what you can from config files:]
- [Indentation: check .editorconfig, prettier config, or eslint config]
- [Module system: check tsconfig or package.json type field]
- [Import style: check eslint rules or existing code patterns]
- [Any other conventions discoverable from linter/formatter configs]

[If nothing is discoverable, use this placeholder:]
- [Describe your code style conventions -- indentation, naming, import organization, etc.]

## Do NOT

[This section requires human input. Generate a starter with common-sense defaults, then flag it for review:]
- [List files or directories that should not be modified without approval]
- [List patterns that are off-limits -- e.g., don't push to main, don't modify CI config, don't add dependencies without discussion]
- [Be specific and actionable -- "don't modify auth middleware" not "be careful with security"]
```

### Full Single File (~100-120 lines)

Generate a single `AGENTS.md` with all minimal sections plus the following. Populate from project analysis; bracket-placeholder what can't be detected.

```markdown
## Command Output Notes

[Generate from discovered test runner, linter, and build commands. For each command, suggest a concise invocation with flags or pipes that reduce output before it enters context. Prefer compact one-line-per-item formats over JSON when error counts could be high. Provide two variants for test commands: a quick pass/fail check (tail for summary) and a debug variant (tail with more lines for tools that put failures at the bottom, or sed to extract failure sections, or tool-native flags like --tb=short).]

[If no commands can be improved with flags, skip this section.]

## MCP Tool Notes

[Same logic as the minimal template: generate only if MCP configs detected, use known templates for recognized servers, placeholder for unknown servers. Include the CLI-first preamble from the minimal template. At the full level, this section sits between Command Output Notes and Project Structure -- the same position used in the single-file examples.]

## Trust Boundary Notes

[Generate this section when trust-adjacent automation is detected: MCP config, Claude hook settings, hook scripts, CI-enforced local automation, or similar operator-owned tooling.]

- [Identify the automation surfaces and their config locations.]
- [State that MCP selection, credentials, hook behavior, and operator-local tooling are not routine edit targets unless explicitly asked.]
- [Describe any stable expectations agents should know, such as "hooks may block writes" or "MCP servers are available for reads but are operator-configured".]

[If a project-root `MEMORY.md` is detected, add a note here:]
- [This repo has a manually created `MEMORY.md`. Remove it -- Claude Code manages its own auto memory at `~/.claude/projects/<project>/memory/`. Migrate any durable content (architecture, policy, conventions) into AGENTS.md or `context/` files. Do not create MEMORY.md manually; it conflicts with the built-in system.]

## Project Structure

[Generate from directory scan. Show the top-level layout with one-line descriptions of what each directory contains. Focus on directories that an AI agent needs to understand -- where source code lives, where tests live, where config lives. Skip node_modules, build output, and other generated directories.]

## Architecture

[Describe the application's layers and how they connect. For a web app, this might be: routing layer, middleware, business logic, data access, database. For a CLI tool: command parsing, core logic, output formatting.]

[If the architecture can be inferred from directory structure and framework conventions, describe it. Otherwise:]
[Describe your application architecture -- what the main layers are, how requests flow through the system, where business logic lives vs. infrastructure.]

## Auth and Permissions

[Check for auth-related packages (passport, next-auth, clerk, supabase auth, jwt libraries) and describe what's detected.]

[If no auth packages detected:]
[Describe your auth mechanism -- how users authenticate, how sessions work, where auth middleware runs, what roles/permissions exist.]

## Data Model

[Check for ORM/database packages (prisma, drizzle, typeorm, sequelize, mongoose, sqlalchemy) and prisma/schema files.]

[If Prisma detected, read schema.prisma for model names and key relationships.]

[If no schema files detected:]
[Describe your core data models, their relationships, and where the schema is defined.]

## API Conventions

[Check for API route directories, OpenAPI specs, or API framework conventions.]

[If framework conventions detected (Next.js API routes, Express router files, FastAPI):]
[Describe discovered route structure and patterns.]

[If not detected:]
[Describe your API conventions -- URL structure, request/response format, error handling pattern, versioning approach.]

## Integration Map

[Generate this section when 2+ distinct service client packages are detected. If only one backing service exists, skip this section -- there's no ambiguity to resolve.]

[Scan dependencies for service client packages and map them to the domains they serve. Format as a table:]

| Domain | Backing Service | Client | Notes |
| --- | --- | --- | --- |
| [domain area] | [service name] | [client file/module path] | [brief note] |

[If a domain's backing service can't be determined from dependencies alone:]
[Map each functional domain to its backing service -- which API or database handles it, where the client code lives, and any relevant notes.]

Not every route goes through the default database. Before creating a new API route or data layer, check this table. If the domain isn't listed, ask before defaulting to [detected primary service].
```

### Cascading + Context Directory

Generate the following file set:

**Project-root `AGENTS.md`** -- Entry point. Contains: project description, tech stack summary, commands, code standards, Do NOT section, trust-boundary summary when relevant, and pointers to `context/` for reference assets and `.claude/rules/` for path-specific instructions. Keep this file under 60 lines. This file should be durable across long sessions: no sprint logs, migration diaries, or bulky troubleshooting notes.

**`context/` directory** -- Reference assets that don't map to file path globs. These are loose resources loaded by whatever needs them -- skills, agents, humans. Not Claude Code-specific. Generate the following based on project complexity:

- **`context/system-overview.md`** -- What the system does at a high level. Business context, user-facing functionality, key workflows. This is the "what" that AGENTS.md doesn't cover.
- **`context/architecture-decisions.md`** -- Why the system is built this way. Key technical choices and their rationale. Framework selection, database choice, auth approach, deployment architecture, and the reasoning behind each.
- **`context/operational-boundaries.md`** -- Generate when trust-adjacent automation is detected or clearly likely to matter. Document MCP servers, hooks, operator-owned local automation, and any expectations about how agents should use or avoid changing those surfaces.
- **`context/technical-requirements.md`** -- Non-functional requirements: performance targets, security requirements, accessibility standards, browser/device support, compliance requirements. Only include sections relevant to the project.
- **`context/api-documentation.md`** -- API surface: endpoints, request/response formats, auth requirements, error codes, versioning. For internal APIs between services, document the contract.
- **`context/working-style-guide.md`** -- How to contribute: PR process, review expectations, testing requirements, branch naming, commit conventions. Team workflow rather than code style.

Additional `context/` files are fine -- methodology docs (TDD, SDD, agile), onboarding guides, research briefs, or any reference material that supports the project. The list above is a starting set, not a ceiling.

**Optional: `@import` for critical context/ files.** Claude Code supports `@path/to/file` syntax in CLAUDE.md that expands at launch, guaranteeing the file loads into every session. For context/ files that should always be available (system-overview, architecture-decisions), adding `@context/system-overview.md` to the root file ensures they load without Claude needing to decide to read them. The tradeoff:

- `@import`: always loaded (reliable, survives compaction via root re-injection), costs tokens every session regardless of relevance
- Standalone: loaded on demand (efficient, zero cost when not needed), may be missed if Claude doesn't know to look

Since CLAUDE.md is a symlink to AGENTS.md, `@import` lines appear in both files. Other tools see `@context/system-overview.md` as literal text -- only Claude Code expands it. This is harmless (other tools ignore the line) but worth knowing. Recommend @importing at most 2-3 critical files to keep the token tradeoff favorable. Leave optional reference docs (methodology, onboarding, research) as standalone files.

**`.claude/rules/` directory** -- Path-specific coding instructions that Claude Code auto-loads when working with matching files. These use YAML `paths:` frontmatter so they consume context tokens only when relevant. Generate rules files when the project has areas with distinct coding patterns. Common candidates:

- **`.claude/rules/api-conventions.md`** with `paths: ["src/api/**"]` -- Error handling, response formats, middleware patterns, auth requirements for API routes.
- **`.claude/rules/component-patterns.md`** with `paths: ["src/components/**"]` -- Component structure, state management, prop conventions, styling approach.
- **`.claude/rules/test-conventions.md`** with `paths: ["tests/**", "**/*.test.*"]` -- Testing patterns, fixture approach, mocking policy, coverage expectations.

Rules without `paths:` frontmatter load unconditionally at session start (same as root CLAUDE.md). Only omit `paths:` when the rule truly applies to all files.

The distinction: `context/` holds reference knowledge (architecture, methodology, requirements). `.claude/rules/` holds coding instructions scoped to file paths. If the content answers "what conventions apply when editing files in this directory?" it belongs in rules. If it answers "why is the system built this way?" or "what methodology do we follow?" it belongs in context.

**Subdirectory `AGENTS.md` files** -- Generate these only for directories that have clearly distinct patterns AND need cross-tool visibility (Cursor, Windsurf, other agents). If the guidance is Claude Code-only, prefer `.claude/rules/` with `paths:` scoping instead -- it auto-loads and survives compaction. Do not duplicate project-root content in either case.

**How compaction affects each layer.** When Claude Code runs `/compact` or auto-compacts during long sessions, prior conversation is summarized but instruction files are selectively re-injected. Understanding what survives determines where to put what:

| Layer | After compaction | Mechanism |
|---|---|---|
| Root CLAUDE.md (symlinked AGENTS.md) | Re-read from disk and re-injected | Always survives |
| `@import`ed files | Re-expanded as part of root re-injection | Survives (because root survives) |
| `.claude/rules/` (no `paths:`) | Re-injected at same priority as root | Always survives |
| `.claude/rules/` (with `paths:`) | Reloads next time Claude reads a file matching the glob | Survives on next relevant file access |
| Subdirectory CLAUDE.md / AGENTS.md | NOT re-injected; reloads next time Claude reads files in that directory | May be lost until Claude works in that area again |
| `context/` files (standalone) | NOT re-injected; only available if Claude decides to re-read | May be lost until explicitly re-read |
| Auto memory (MEMORY.md index) | Re-injected (first 200 lines / 25KB) | Always survives |
| Conversation-only instructions | Summarized or lost | Does not survive -- add to AGENTS.md if durable |

This is why the root file should be a durable entrypoint (stable guidance that matters every session), critical reference assets should be @imported (guaranteed re-injection), and path-specific instructions should use `.claude/rules/` with `paths:` (automatic reload on file access). Volatile detail in standalone `context/` files is fine -- it only needs to be available when relevant, and Claude can re-read it.

If a project-root `MEMORY.md` is detected:

- do not adopt it as the primary context format
- do not generate a new `MEMORY.md`
- flag it in the output summary: "Found project-root MEMORY.md. This conflicts with Claude Code's built-in auto memory system (`~/.claude/projects/<project>/memory/`). Recommend removing it and migrating any durable content into AGENTS.md or context/ files."
- if it contains architecture, policy, or conventions, extract those into the appropriate generated files

## Key Constraints

- Never fabricate project information. If something can't be detected, use a bracket placeholder. `[describe your auth mechanism]` is better than a wrong guess.
- Populate sections from config files and directory structure, not from reading application code. Scanning code for architectural patterns is unreliable and slow.
- The CLAUDE.md symlink is required. Always create it. Symlink is chosen over `@AGENTS.md` import for measurable reasons: 1 read-resolution step (OS inode follow) vs 5 (detect `@`, resolve path, read, parse, inline); 1 write target vs 2 (import creates a second file that can accumulate divergent content); 1 possible divergence point (broken symlink) vs N (primary + every imported file, up to 5 levels deep); transparent to all tools (cat, grep, Cursor, Windsurf, Claude Code) vs Claude Code only (@import is not resolved by other tools reading CLAUDE.md). The symlink-check hook and audit skill enforce integrity with 3 checks (not symlink, wrong target, missing).
- Bracket placeholders should describe the *kind* of content that belongs there, not just say `[TODO]`. Write `[describe how requests flow from route handler to database and back]` not `[fill in later]`.
- Keep the root file as an entrypoint, not a dump. If generated content starts to exceed that role, prefer a `context/` file over stuffing more volatility into `AGENTS.md`.
- `AGENTS.md` stays primary. `CLAUDE.md` is the compatibility surface (see symlink rationale above). Do not create or encourage project-root `MEMORY.md` files -- Claude Code has a built-in auto memory system at `~/.claude/projects/<project>/memory/` that Claude manages automatically. Users should not manually create MEMORY.md; if one exists, recommend removing it.

## Full Instruction Hierarchy

Teams making context decisions should understand every layer Claude Code loads, from broadest to most specific. More specific layers take precedence:

| Layer | Location | Who writes it | Shared with | Use for |
|---|---|---|---|---|
| Managed policy | macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md`; Linux/WSL: `/etc/claude-code/CLAUDE.md` | IT/DevOps via MDM, Ansible, etc. | All users on machine (cannot be excluded) | Org-wide coding standards, security policies, compliance requirements, data handling rules |
| Project instructions | `./AGENTS.md` (with `./CLAUDE.md` symlink) and `.claude/rules/` | Team (version-controlled) | All team members | Project architecture, conventions, commands, trust boundaries, path-specific coding instructions |
| User instructions | `~/.claude/CLAUDE.md` and `~/.claude/rules/` | Individual | Just you (all projects) | Personal coding preferences, tooling shortcuts, cross-project workflow habits |
| Local instructions | `./CLAUDE.local.md` (gitignored) | Individual | Just you (this project) | Sandbox URLs, preferred test data, local dev overrides |
| Auto memory | `~/.claude/projects/<project>/memory/` | Claude (automatic) | Just you (this project) | Corrections, debugging insights, build commands Claude discovers |

When scaffolding for a team, consider which layers are already in place. If the organization deploys a managed policy, project-level instructions should complement it (not duplicate or contradict it). If team members have strong personal preferences, those belong in `~/.claude/CLAUDE.md` or `CLAUDE.local.md` -- not in the shared AGENTS.md.

In monorepos with multiple teams, `claudeMdExcludes` in `.claude/settings.local.json` filters out other teams' CLAUDE.md files that add noise. Glob patterns match against absolute paths.

## When to Use

- When setting up a new project that has no context files
- When inheriting a project that lacks AI-oriented documentation
- When converting existing documentation into the AGENTS.md structure
- After running `/onboard` and finding that the project has no context files

**How this relates to `/init`:** Claude Code's built-in `/init` command generates a starting CLAUDE.md from codebase analysis. Use `/init` for a quick bootstrap when you just need build commands and basic conventions. Use `context-scaffold` when you need complexity-level recommendations, trust boundary documentation, MCP optimization notes, `.claude/rules/` generation, and structured verification via `context-audit` and `context-align`.

## Example Output

> Analyzed project. Here's what I found:
>
> **Tech stack:** Node.js 20, Next.js 15, React 19, TypeScript, Tailwind CSS, Prisma with PostgreSQL, deployed on Vercel.
>
> **Structure:** 47 directories, 3 distinct areas (app routes, API routes, shared components). Auth via NextAuth with GitHub and Google providers.
>
> **MCP servers:** `.mcp.json` found with 2 servers (supabase, github-mcp-server). Both match known templates -- MCP Tool Notes will be pre-populated.
>
> **Trust surfaces:** `.claude/settings.json` found with a pre-tool hook. Trust Boundary Notes will be added so operator-owned automation is documented explicitly.
>
> **Recommendation: Full single file.** This is a single deployable app with enough layers (frontend, API, database, auth) to benefit from the expanded template, but not complex enough to warrant a context directory. One AGENTS.md covers it.
>
> Want to proceed with full single file, or choose a different level?

After generation:

> Created 2 files:
>
> - `AGENTS.md` (108 lines) -- populated tech stack, commands, project structure, and API conventions from project analysis
> - `CLAUDE.md` -- symlink to AGENTS.md
>
> Sections needing human review (bracket placeholders):
>
> - **Architecture:** data flow description (line 58)
> - **Auth and Permissions:** role definitions (line 74)
> - **Trust Boundary Notes:** confirm which MCP and hook surfaces are operator-owned (line 42)
> - **Do NOT:** all entries are starter defaults -- review and customize (lines 98-104)

## Notes

This skill generates context files; it doesn't maintain them. After generating, use `/context-setup:context-align` periodically to check for drift between context files and the codebase.

The complexity recommendation is a starting point, not a rule. A small project with unusual architecture might benefit from the full template. A large project with simple patterns might only need the minimal one. The recommendation is based on heuristics (directory count, dependency count, presence of auth/database layers), but the user makes the final call.

Bracket placeholders are intentional friction. They mark sections where auto-detection isn't reliable enough and human knowledge is required. Resist the temptation to fill them with guesses from code scanning -- a placeholder that says "describe your auth flow" prompts the human to write the accurate version.

Long-session survivability matters. If the repo has enough detail that the root file stops being a compact always-loadable entrypoint, prefer cascading output and push volatile detail into `context/`.
