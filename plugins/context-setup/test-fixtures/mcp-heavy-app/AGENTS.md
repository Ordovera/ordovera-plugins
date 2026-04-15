# AGENTS.md

Internal operations dashboard with Supabase backend, Jira integration, and Sentry monitoring.

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Supabase (database, auth, storage)
- Tailwind CSS

## Commands

- `npm run dev` -- start dev server
- `npm run build` -- production build
- `npm run test` -- run vitest
- `npm run lint` -- run eslint

## Project Structure

- `src/api/` -- API route handlers
- `src/components/` -- shared UI components
- `src/lib/` -- Supabase client, utilities

## Data Model

- Operations are stored in Supabase `operations` table
- Users are managed via Supabase Auth
- File attachments use Supabase Storage

## Auth and Permissions

- Supabase Auth with row-level security
- Admin and operator roles
- API routes require authenticated session

## External Integrations

- Jira: ticket creation and status sync via Atlassian MCP
- Sentry: error tracking and alerting
- GitHub: PR automation and code review
- Google Calendar: scheduling for operations reviews
- Vercel: deployment pipeline

## MCP Tool Notes

- **Atlassian (Jira)** -- use `searchJiraIssuesUsingJql` with `maxResults: 5` for triage
- **Supabase** -- query with `.select('col1, col2')` to limit columns

## Trust Boundary Notes

- MCP servers are configured at project and editor level
- Hooks enforce preflight checks on write operations
- Sentry integration has read-only access

## Code Standards

- Prefer server components where possible
- Use Supabase RLS instead of application-level auth checks
- Keep API routes thin, delegate to lib/

## Do NOT

- Do not bypass Supabase RLS with service role key in client code
- Do not commit .env.local
