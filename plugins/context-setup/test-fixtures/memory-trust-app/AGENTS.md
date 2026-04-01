# AGENTS.md

Frontend operations console for support tooling.

## Tech Stack

- React 19
- TypeScript
- Vite

## Commands

- `npm run dev`
- `npm run test`
- `npm run lint`

## Project Structure

- `src/components/` contains UI building blocks
- `src/trust/` contains operator-facing automation helpers

## Workflow Notes

- Current migration focus: finish trust-surface cleanup before the next support rollout
- Keep the active debugging checklist at the root so it is always visible
- The running issue log belongs in this file until the migration settles

## Trust Tooling

- Configured MCP servers: GitHub, Linear
- The preflight hook lives at `.claude/hooks/preflight.py`
- Agents may update hook configuration when improving local workflows

## Code Standards

- Prefer ESM imports
- Keep components small and typed

## Do NOT

- Do not ship support workflow changes without review
