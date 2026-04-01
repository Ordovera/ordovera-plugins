---
name: attack-surface
description: Map the project's attack surface -- endpoints, authentication, integrations, secrets, and trust boundaries.
---

# Attack Surface Discovery

Map the project's attack surface to understand where it is exposed and how it handles security. This is a lightweight, tool-free analysis -- no external dependencies required.

Use this as a first step before running a full audit (`/top10-scan:security-audit`), or on its own to understand a new codebase's security posture.

## Resolving plugin directory

`<plugin_dir>` refers to the root directory of this plugin. Resolve it by locating the directory containing this SKILL.md file and going two levels up (from `skills/attack-surface/SKILL.md` to the plugin root). The plugin root contains `scripts/`, `owasp-cache/`, and `templates/`.

## Step 1: Framework Detection

Run the detection script:

```bash
python3 <plugin_dir>/scripts/detect-framework.py .
```

Parse the JSON output. Tell the user what was detected.

**Inline fallback:** If Python is unavailable or the user denies the command, manually check for framework markers:

- next.config.* (Next.js), manage.py + settings.py (Django), Gemfile + config/routes.rb (Rails)
- go.mod (Go), Cargo.toml (Rust), *.csproj with Microsoft.AspNetCore (ASP.NET)
- package.json dependencies for express, fastify, koa
- requirements.txt/pyproject.toml for fastapi

## Step 2: Scope Check

Before mapping, assess the project size:

**If the project contains multiple services or apps** (e.g., `services/`, `apps/`, or multiple framework markers in separate directories), ask the user:

> Multiple services detected: [list]. Map all of them, or focus on one?

Wait for the user to choose.

**If the project is very large** (many route files, hundreds of endpoints), note this up front and focus the analysis:

> Large project detected. Focusing on: auth-adjacent routes, admin endpoints, routes handling PII/credentials, and external integrations. The surface map will note areas that were scanned vs. areas that need further review.

## Step 3: Attack Surface Map

Read the project structure and produce a comprehensive attack surface map covering:

### Endpoints

Find all API routes, pages, and URL patterns. For each, determine:

- Route path and HTTP method
- Whether authentication is required
- What data it handles (PII, credentials, business data, public)
- Input sources (query params, body, headers, path params)

Present as a table:

| Route | Method | Auth Required | Data Sensitivity | Notes |
| ----- | ------ | ------------- | ---------------- | ----- |

### Authentication Mechanisms

Identify all auth approaches: session, JWT, OAuth, API keys, basic auth. For each:

- Where is it implemented?
- Where is it validated (middleware, per-route, etc.)?
- Are there gaps (routes that should require auth but don't)?

### External Integrations

List all third-party services: databases, APIs, message queues, file storage, payment providers. For each:

- Connection method (SDK, REST, direct connection)
- How credentials are managed
- Whether connections use TLS

### Secrets Handling

Identify how secrets are stored and accessed:

- Environment variables vs config files vs hardcoded values
- Whether .env files are gitignored
- Whether secrets appear in client-side code or logs

### Trust Boundaries

Map where user input enters the system and where data crosses privilege levels:

- Public-facing endpoints
- Internal service-to-service calls
- Admin interfaces
- Background job inputs

## Output

Present the complete attack surface map to the user in a structured, readable format. Flag any immediately obvious concerns (unprotected admin routes, hardcoded secrets, missing auth on sensitive endpoints).

If the analysis was scoped to high-risk areas, note which parts of the codebase were covered and which were not:

> Surface map covers [N] endpoints across [directories analyzed]. Areas not covered: [list]. Run again with a specific service for deeper analysis.

## Notes

- This skill requires no external tools -- it relies entirely on Claude reading the codebase
- The security-audit skill performs its own attack surface discovery as part of the full audit -- it does not consume the output of this skill. Running this skill first helps you understand the codebase before committing to a full audit.
- For a codebase you're seeing for the first time, start here before running tool-based scans
