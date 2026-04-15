# Test Fixtures

Curated projects that model specific scenarios the plugin is expected to handle. Several fixtures contain **intentional defects** -- stale references, misused files, contradictions -- that are the test cases themselves. Do not fix these; the verification harness confirms they are still present.

Expected results live under `expected-results/`. Verification harness at `scripts/verify-context-setup.py`.

## minimal-node-app

**Tests:** Scaffold restraint -- the plugin should not over-engineer a simple project.

Small single-package TypeScript app. One package manager, limited source tree, no pre-existing context files.

**No intentional defects.** This is a clean fixture. No AGENTS.md, no CLAUDE.md, no context/ directory. Scaffold should generate minimal output.

**Key signals:** vitest, eslint, TypeScript in package.json. No auth, no database, no API routes.

**Expected results:** Scaffold produces AGENTS.md + CLAUDE.md symlink with minimal headings. No cascading, no architectural sections.

## fullstack-app

**Tests:** Scaffold completeness -- the plugin should detect and document a complex project appropriately.

Next.js app with auth (next-auth), database (Prisma), API routes, and layered structure. No pre-existing context files.

**No intentional defects.** Clean fixture like minimal-node-app but with more complexity signals.

**Key signals:** next, next-auth, prisma in dependencies. `app/api/` route structure. `prisma/schema.prisma` present.

**Expected results:** Scaffold produces full single-file AGENTS.md with Data Model, Auth, and API sections.

## stale-context-app

**Tests:** Audit finding detection and align drift detection -- the plugin should catch stale references and contradictions.

Project with valid source code but intentionally stale and contradictory context files.

**Intentional defects (do not fix):**

| Defect | Location | What it tests |
|--------|----------|---------------|
| CLAUDE.md is a regular file, not a symlink | `CLAUDE.md` contains `See AGENTS.md.` | Audit should flag non-symlink CLAUDE.md |
| AGENTS.md says React 18, package.json has React 19 | `AGENTS.md` vs `package.json` | Align should detect version drift |
| AGENTS.md references `src/lib/auth/` | `AGENTS.md` | Align should detect missing path (actual path is `src/middleware/auth.ts`) |
| AGENTS.md references `npm run test:api` | `AGENTS.md` and `context/architecture-decisions.md` | Audit and align should detect stale command (no such script in package.json) |
| Subdirectory AGENTS.md says Jest | `src/api/AGENTS.md` | Audit and align should detect contradiction with root (which says vitest) |

**Expected results:** Audit finds symlink issue, stale commands, stale paths, contradiction. Align finds version drift, missing paths, stale commands, test runner contradiction.

## memory-trust-app

**Tests:** Trust-boundary detection, MEMORY.md misuse, MCP/hook configuration awareness, context budget (healthy case), MCP inventory (simple case).

Project with MCP config, hook config, volatile workflow notes in root AGENTS.md, and an overused MEMORY.md.

**Intentional defects (do not fix):**

| Defect | Location | What it tests |
|--------|----------|---------------|
| CLAUDE.md is a regular file, not a symlink | `CLAUDE.md` contains `See AGENTS.md.` | Audit should flag non-symlink CLAUDE.md |
| AGENTS.md says MCP servers are GitHub and Linear | `AGENTS.md` line 30 | Align should detect drift (`.mcp.json` configures GitHub and Sentry) |
| AGENTS.md says hook is at `.claude/hooks/preflight.py` | `AGENTS.md` line 31 | Align should detect drift (`.claude/settings.json` points to `scripts/hooks/preflight.py`) |
| MEMORY.md duplicates durable project policy | `MEMORY.md` lines 5-7 | Audit should flag MEMORY.md misuse (restates React 19, MCP servers, code review rule) |
| MEMORY.md references `context/session-memory.md` | `MEMORY.md` line 13 | Align should detect missing file reference |
| Volatile workflow notes in root AGENTS.md | `AGENTS.md` lines 24-26 | Audit should flag that migration notes and debugging checklists belong in context/ files |
| AGENTS.md grants agents hook-editing authority | `AGENTS.md` line 32 | Audit should flag overly broad trust boundary |

**Expected results:** Audit finds volatile root notes, missing trust-boundary documentation, MEMORY.md misuse. Align finds MCP server drift, hook path drift, missing session-memory reference. Budget reports healthy (2 MCP servers, 1 hook, small CLAUDE.md chain). MCP inventory finds 2 servers from `.mcp.json`, no overlaps.

## mcp-heavy-app

**Tests:** Context budget under pressure, MCP inventory with multiple config sources and cross-platform overlap.

Next.js + Supabase project with many MCP integrations across project and editor configs, multiple hooks, memory directory, and established AGENTS.md with MCP Tool Notes and Trust Boundary sections.

**No intentional audit/align defects.** This fixture is designed for context-budget and mcp-inventory verification, not for drift or audit testing. The CLAUDE.md is a regular file (consistent with representing an established project), but this is not an audit test target.

**Key signals:**

| Signal | Location | What it tests |
|--------|----------|---------------|
| 4 MCP servers (atlassian, github, supabase, sentry) | `.mcp.json` | Budget counts project-level MCP cost; inventory enumerates project servers |
| 2 MCP servers (github, vercel) | `.vscode/mcp.json` | Budget counts editor-level MCP cost; inventory enumerates editor servers |
| github appears in both configs | `.mcp.json` and `.vscode/mcp.json` | Inventory should flag cross-platform overlap; budget should count 5 unique, not 6 |
| 2 hook definitions (Write/Edit, Bash) | `.claude/settings.json` | Budget counts hook definitions |
| Memory index with 3 file references | `memory/MEMORY.md` | Budget measures memory index size |
| context/ directory with deployment notes | `context/deployment-notes.md` | Budget notes context directory presence |
| Large AGENTS.md with MCP Tool Notes section | `AGENTS.md` | Budget measures CLAUDE.md chain token cost |

**Expected results:** Budget reports pressure diagnosis (5 unique MCP servers across 2 sources, github overlap). MCP inventory finds 6 entries from 2 config files, 5 unique servers, flags github overlap.
