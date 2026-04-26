---
name: context-upgrade
description: Guides transition from your current context level to the next one -- minimal to full, full to cascading, or adding skills and hooks layers. Preserves existing content.
---

# Context Upgrade

Guide a transition from your current context level to the next one without losing existing content.

## What This Skill Does

1. **Detect current level** by reading existing context files:
   - No context files found -- equivalent to running scaffold
   - Single AGENTS.md under ~60 lines -- minimal level
   - Single AGENTS.md over ~60 lines -- full level
   - AGENTS.md + context/ directory, `.claude/rules/`, or multiple AGENTS.md files -- cascading level
   - Check for `.claude/skills/` and `.claude/settings.json` hooks to assess skills/hooks layers
   - Check for `.claude/rules/` directory and whether rules files have `paths:` frontmatter
   - Check for `.mcp.json` and equivalent MCP config to assess trust-adjacent surfaces
   - Check for project-root `MEMORY.md` -- if present, it conflicts with Claude Code's built-in auto memory and should be flagged for removal

2. **Identify the appropriate upgrade path** based on current level and project signals.

3. **Execute the upgrade** with the user's confirmation, preserving all existing content.

## Upgrade Paths

### No Context to Minimal

Equivalent to running `/context-setup:context-scaffold` at the minimal level. Generate AGENTS.md from project analysis with sections: project description, tech stack, commands, code standards, Do NOT. If trust-adjacent automation is already present, include a lightweight trust-boundary section or placeholder. Create CLAUDE.md symlink.

### Minimal to Full Single File

Read the existing AGENTS.md. Identify which full-level sections are missing. The full level adds these sections beyond minimal:

- **Project Structure** -- directory layout with descriptions. Generate from filesystem scan.
- **Architecture** -- application layers and data flow. Populate what's inferable from framework and directory conventions; bracket-placeholder the rest.
- **Auth and Permissions** -- auth mechanism, session handling, roles. Populate from detected auth packages; bracket-placeholder specifics.
- **Data Model** -- core models and relationships. Populate from schema files if present (Prisma, SQLAlchemy models, etc.); bracket-placeholder otherwise.
- **API Conventions** -- URL structure, request/response format, error handling. Populate from detected route structure; bracket-placeholder conventions.
- **Trust Boundary Notes** -- add when MCP config, hooks, or other operator-owned automation exists. Document what agents may rely on, what is operator-owned, and what should not be changed casually.

Insert missing sections into the existing file after the current content, preserving everything already written. Do not rewrite or reorder existing sections.

If a project-root `MEMORY.md` exists:

- flag it: "Found project-root MEMORY.md. This conflicts with Claude Code's built-in auto memory (`~/.claude/projects/<project>/memory/`). Claude manages its own memory automatically."
- extract any durable content (architecture, policy, conventions) into the appropriate AGENTS.md sections being generated
- recommend removing the project-root file after migration
- do not preserve it as "working memory" -- Claude's built-in auto memory handles that

**Trigger signals** (when minimal is no longer enough):

- Project has multiple layers (frontend + backend, or API + workers)
- Auth packages present but not documented
- Database/ORM present but data model not documented
- API routes exist but conventions not documented

### Full Single File to Cascading + Context Directory

Read the existing AGENTS.md. Sort extracted content into two destinations based on purpose:

- **`context/`** for reference assets (architecture, methodology, requirements, system overview). These are loaded on demand by whatever needs them -- not Claude Code-specific.
- **`.claude/rules/`** for path-specific coding instructions with `paths:` frontmatter. These auto-load in Claude Code when working with matching files and survive compaction.

1. **Rewrite AGENTS.md** as the project-level entry point:
   - Keep: project description, tech stack summary, commands, code standards, Do NOT
   - Add: a note pointing to `context/` for reference assets and `.claude/rules/` for path-specific instructions
   - Add: a short trust-boundary summary when MCP, hooks, or operator-owned automation exist
   - Target: under 60 lines

2. **Create context/ directory** with reference assets extracted from the existing AGENTS.md:
   - `system-overview.md` -- extracted from project description + any business context
   - `architecture-decisions.md` -- extracted from Architecture section, restructured as decisions with rationale
   - `operational-boundaries.md` -- extracted from trust-surface notes, hook guidance, MCP notes, or operator-owned automation guidance when present
   - `technical-requirements.md` -- extracted from any performance, security, or compliance notes (may need bracket placeholders if this wasn't in the original)
   - `api-documentation.md` -- extracted from API Conventions section (API surface and contracts, not coding instructions for the API layer)
   - `working-style-guide.md` -- extracted from any contribution or workflow notes (may need bracket placeholders)

   Additional context/ files are fine -- methodology docs, onboarding guides, research briefs. The list above is a starting set.

   **Optional: @import critical context/ files.** Claude Code supports `@path/to/file` in CLAUDE.md (which is a symlink to AGENTS.md, so both files carry the line). Adding `@context/system-overview.md` to the root file guarantees it expands at launch -- no decision needed, survives compaction. The tradeoff: @imported files cost tokens every session. Recommend @importing at most 2-3 critical files (system-overview, architecture-decisions); leave optional reference docs as standalone.

3. **Create `.claude/rules/` files** for path-specific coding instructions extracted from the existing AGENTS.md or subdirectory AGENTS.md files. Each rules file should have `paths:` frontmatter so it loads only when Claude works with matching files. Common candidates:

   - `api-conventions.md` with `paths: ["src/api/**"]` -- error handling, response formats, middleware patterns
   - `component-patterns.md` with `paths: ["src/components/**"]` -- component structure, state management, styling
   - `test-conventions.md` with `paths: ["tests/**", "**/*.test.*"]` -- testing patterns, fixture approach, mocking policy

   Rules without `paths:` load unconditionally (same token cost as root CLAUDE.md). Only omit `paths:` when the rule applies to all files.

4. **Move volatile detail out of the root file**:
   - Current migration notes, sprint logs, troubleshooting diaries, and other compaction-hostile material should move into appropriate `context/` files or be dropped if they are stale
   - The goal is a durable entrypoint, not a smaller dump file

5. **Create subdirectory AGENTS.md files** only where cross-tool visibility is needed (Cursor, Windsurf, other agents that don't read `.claude/rules/`). If the guidance is Claude Code-only, prefer `.claude/rules/` with `paths:` scoping -- it auto-loads and survives compaction.

   Only create subdirectory files where there are genuinely different patterns. A subdirectory file that would just say "follow the root conventions" should not exist.

6. **Remove project-root `MEMORY.md` if present**:
   - Claude Code has a built-in auto memory system at `~/.claude/projects/<project>/memory/` -- users should not maintain a manual MEMORY.md
   - Extract any durable content (architecture, policy, conventions) into the appropriate context/ files or .claude/rules/ files being generated
   - Recommend deleting the project-root file after migration
   - Note in the upgrade output: "Removed project-root MEMORY.md. Claude Code manages auto memory automatically at ~/.claude/projects/<project>/memory/. Use /memory to browse and edit."

7. **Verify no content was lost** by comparing section coverage before and after.

**Trigger signals** (when a single file is no longer enough):

- AGENTS.md exceeds ~150 lines
- Multiple contributors need different sections at different times
- Multi-project workspace or monorepo
- Conversations regularly hit context budget from loading the entire file

### Add Skills Layer

Check whether `.claude/skills/` exists and what skills are present.

Describe the three operational skills that complement context files:

- **onboard** -- Discovers and summarizes the project's context structure. Run at session start or when joining a project. Read-only orientation.
- **context-align** -- Cross-references context files against the codebase for drift. Checks tech stack, directory references, commands, and cascading contradictions. Run periodically or after upgrades.
- **scope-check** -- Validates planned tasks against AGENTS.md boundary rules before starting work. Three-level assessment: clear, warning, blocked. Run before tasks in protected areas.

These skills consume the same AGENTS.md files that the project already has. They add operational automation on top of the declarative context layer.

When this layer is suggested after a cascading upgrade, explain that skills should read the durable root entrypoint plus supporting `context/` files, not depend on volatile notes living at the root.

Note: The distribution mechanism for skills may vary. The `context-engineering` repo provides working examples in `examples/claude-config/skills/`. How you install them depends on your tool and workflow.

**Trigger signals** (when to add skills):

- Using context files regularly and wanting proactive validation
- Onboarding new contributors frequently
- Context files have drifted from codebase in the past
- Working in areas with declared boundaries

### Add Hooks Layer

Check whether `.claude/settings.json` has hook configurations.

Describe the hooks that enforce what AGENTS.md declares:

- **boundary-guard** (PreToolUse) -- Runs before every file edit. Finds the nearest AGENTS.md, extracts boundary rules from "Do NOT" and "Boundaries" sections, and blocks edits to restricted files. The rule moves from guidance to enforcement.
- **lint-markdown** (PostToolUse) -- Runs after file edits to `.md` files. Runs markdownlint and blocks if violations are found. Enforces consistent markdown formatting.
- **symlink-check** (PostToolUse) -- Verifies CLAUDE.md is a symlink after file operations. Notification only, never blocks.

Explain the three-layer defense model:

1. **AGENTS.md is declarative** -- says what to do and not do. Advisory.
2. **Hooks are imperative** -- enforce rules at execution time. Blocking.
3. **Skills are operational** -- validate at planning time and check for drift. Proactive.

All three layers read the same AGENTS.md files. The context file is the single source of truth; skills and hooks are the operational enforcement layer.

If MCP config or hooks already exist but are undocumented, recommend adding or upgrading trust-boundary guidance before adding more enforcement. The user chooses which automation to trust; the upgrade should make that trust surface legible.

Working implementations of these hooks are available in `<plugin_dir>/hooks/` with a test suite that verifies all allow/block decisions. See `hooks/README.md` for installation instructions.

Note: Hook registration (settings.json format, event types) is Claude Code-specific. The hook scripts themselves are portable shell/Python scripts.

**Trigger signals** (when to add hooks):

- Need enforcement, not just guidance
- Boundary violations have happened despite context files
- Want automated markdown quality checks
- Multiple AI agents working in the same codebase

## When to Use

- After `/context-setup:context-audit` recommends upgrading to a higher level
- When your AGENTS.md is getting too long for a single file
- When adding contributors (human or AI) who need better context coverage
- When moving from solo development to team development
- When you want to add operational enforcement on top of declarative context

## Example Output

> **Current level: Full single file**
> AGENTS.md is 142 lines with 7 sections. No context directory. No subdirectory AGENTS.md files. No skills or hooks detected.
>
> **Recommended upgrade: Cascading + context directory**
> Your AGENTS.md is approaching the ~150 line threshold, and the project has 3 distinct areas (API routes, React components, database migrations) that would benefit from their own conventions.
>
> **Upgrade plan:**
>
> 1. Rewrite AGENTS.md as a 55-line entry point (keep: description, stack, commands, standards, Do NOT, trust summary)
> 2. Create context/ directory with 5 reference asset files extracted from current content, including operational-boundaries.md
> 3. Create .claude/rules/ with 2 path-scoped rules: api-conventions.md (paths: src/api/**) and test-conventions.md (paths: tests/**)
> 4. Move current migration notes out of the root file so the entrypoint stays durable across long sessions
> 5. Create CLAUDE.md symlink (currently missing)
> 6. Remove project-root MEMORY.md (conflicts with Claude Code's built-in auto memory; durable content migrated to context/ files)
>
> No content will be lost -- existing sections move to context/ files or .claude/rules/. Want to proceed?

## Notes

Upgrades are additive. Each level builds on the previous one rather than replacing it. Minimal sections (tech stack, commands, standards, Do NOT) persist at every level -- they just move to the project-root AGENTS.md as the canonical quick-reference while detailed content moves to context/ files.

The trigger signals are guidelines, not thresholds. A 140-line AGENTS.md that's well-organized and covers a straightforward project doesn't need to be split into cascading files just because it's near 150 lines. Upgrade when the structure becomes a bottleneck, not when an arbitrary metric is hit.

Content extraction during the full-to-cascading upgrade requires sorting by purpose, not just moving headings. An "Architecture" section might contain both architectural decisions (goes to context/architecture-decisions.md) and business context (goes to context/system-overview.md). An "API Conventions" section might contain both API surface documentation (goes to context/api-documentation.md) and coding instructions for the API layer (goes to .claude/rules/api-conventions.md with `paths:` scoping). The distinction: reference knowledge goes to context/, path-specific coding instructions go to .claude/rules/.

This skill explains what each layer does, when it's valuable, and what trigger signals suggest it's time. Working hook implementations with tests are provided in `<plugin_dir>/hooks/`. The user decides how and when to install.

`AGENTS.md` remains primary throughout every upgrade path. `CLAUDE.md` remains the compatibility surface (symlink). Do not create or preserve project-root `MEMORY.md` files -- Claude Code has a built-in auto memory system at `~/.claude/projects/<project>/memory/` that Claude manages automatically. Users can browse and edit auto memory via `/memory`.
