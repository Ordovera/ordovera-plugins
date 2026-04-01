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
   - Detect `MEMORY.md` if present. Treat it as an existing optional artifact to reconcile with generated context, not as the primary format to adopt.

2. **Determine complexity level.** Present a recommendation with rationale, let the user choose:
   - **Minimal** (~40 lines): Solo project, single language, straightforward structure. One deployment target, no auth layer, no multi-service architecture.
   - **Full single file** (~100-120 lines): Multi-layer app (frontend + backend), auth system, database, API with conventions worth documenting. Multiple backing services (database + external APIs). Still a single deployable unit. Also appropriate when the project has meaningful trust surfaces (MCP, hooks, operator-owned automation) but not enough architectural depth to warrant a `context/` split.
   - **Cascading + context directory**: Multiple projects or workspaces, team environment, complex architecture with distinct subsystems. Or a single project large enough that a single file would exceed ~150 lines. Prefer this level when the root file is at risk of becoming a dump of volatile migration notes, current-session context, or operational detail that should instead live in subordinate files.

3. **Generate files** based on the chosen level (templates below).

4. **Post-generation:**
   - Create `CLAUDE.md` symlink: `ln -s AGENTS.md CLAUDE.md`
   - List what was created
   - Highlight sections with bracket placeholders that need human review
   - If `MEMORY.md` already exists, call it out explicitly: keep it only if it holds short-lived working memory, and move durable policy or architecture back into `AGENTS.md` / `context/`

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

[If the project already has `MEMORY.md`, add one short note here or in a nearby section:]
- [This repo also has `MEMORY.md`; keep it for short-lived working memory only. Durable rules belong in AGENTS.md or `context/` files.]

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

**Project-root `AGENTS.md`** -- Entry point. Contains: project description, tech stack summary, commands, code standards, Do NOT section, trust-boundary summary when relevant, and a note pointing to `context/` for architectural detail. Keep this file under 60 lines. This file should be durable across long sessions: no sprint logs, migration diaries, or bulky troubleshooting notes.

**`context/system-overview.md`** -- What the system does at a high level. Business context, user-facing functionality, key workflows. This is the "what" that AGENTS.md doesn't cover.

**`context/architecture-decisions.md`** -- Why the system is built this way. Key technical choices and their rationale. Framework selection, database choice, auth approach, deployment architecture, and the reasoning behind each.

**`context/operational-boundaries.md`** -- Generate this file when trust-adjacent automation is detected or clearly likely to matter. Document MCP servers, hooks, operator-owned local automation, and any expectations about how agents should use or avoid changing those surfaces.

**`context/technical-requirements.md`** -- Non-functional requirements: performance targets, security requirements, accessibility standards, browser/device support, compliance requirements. Only include sections relevant to the project.

**`context/api-documentation.md`** -- API surface: endpoints, request/response formats, auth requirements, error codes, versioning. For internal APIs between services, document the contract.

**`context/working-style-guide.md`** -- How to contribute: PR process, review expectations, testing requirements, branch naming, commit conventions. Team workflow rather than code style.

**Subdirectory `AGENTS.md` files** -- Generate these only for directories that have clearly distinct patterns worth documenting. Common candidates:

- `src/api/` or equivalent API layer (error handling, response formats)
- `src/components/` or equivalent UI layer (component patterns, state management)
- `tests/` (testing conventions, fixture patterns, mocking approach)

Each subdirectory file should contain only what's specific to that area. Do not duplicate project-root content.

If `MEMORY.md` already exists:

- do not replace `AGENTS.md` with it
- do not generate a new `MEMORY.md` by default
- mention in the output summary that it was detected
- recommend trimming it to volatile execution context if it duplicates durable policy or architecture

## Key Constraints

- Never fabricate project information. If something can't be detected, use a bracket placeholder. `[describe your auth mechanism]` is better than a wrong guess.
- Populate sections from config files and directory structure, not from reading application code. Scanning code for architectural patterns is unreliable and slow.
- The CLAUDE.md symlink is required. Always create it.
- Bracket placeholders should describe the *kind* of content that belongs there, not just say `[TODO]`. Write `[describe how requests flow from route handler to database and back]` not `[fill in later]`.
- Keep the root file as an entrypoint, not a dump. If generated content starts to exceed that role, prefer a `context/` file over stuffing more volatility into `AGENTS.md`.
- `AGENTS.md` stays primary. `CLAUDE.md` is the compatibility surface. `MEMORY.md`, when present, is optional and secondary.

## When to Use

- When setting up a new project that has no context files
- When inheriting a project that lacks AI-oriented documentation
- When converting existing documentation into the AGENTS.md structure
- After running `/onboard` and finding that the project has no context files

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
