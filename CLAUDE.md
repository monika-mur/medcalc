# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Deploy to Cloudflare Workers: `npx wrangler deploy`

## Environment setup

Copy `.env.example` to both `.env` and `.dev.vars`.

Wrangler reads `.dev.vars` (not `.env`) for runtime secrets during `npm run dev`. Both files must exist locally for the dev server to work correctly.

## Cloudflare Workers constraints

- Output mode is `"server"` (SSR) — this is not a static site.
- Avoid Node.js-only APIs; the `nodejs_compat` flag polyfills common ones, but Web APIs are preferred.
- `SUPABASE_URL` and `SUPABASE_KEY` are declared as `context: "server", access: "secret"` in `astro.config.mjs` — they are never available client-side, even if imported.

## TypeScript

- Strict mode enabled via `astro/tsconfigs/strict` with full project-service type checking.
- Import alias: `@/*` resolves to `src/*` — use this instead of relative `../../` paths.

## UI components (shadcn/ui)

- shadcn/ui `new-york` style (`@components.json`). Add: `npx shadcn@latest add <name>` → `src/components/ui/`.

## Code style

- `react-compiler` ESLint plugin is set to `error` — React Compiler rules must pass.
- `no-console` is a `warn` — avoid `console.log` in committed code.

## Auth & route protection

- Protected routes are configured via `PROTECTED_ROUTES` array in `src/middleware.ts` — add new protected paths there, not inside individual page components.
- Auth routes: `/auth/signin`, `/auth/signup`, `/auth/confirm-email`; post-auth redirect: `/dashboard`.

## Supabase

- Local dev: run `npx supabase start`, then copy the printed `API URL` and `anon key` to `.env` and `.dev.vars`.
- Cloud: set `.env` and `.dev.vars` to your cloud project values.
- No migrations exist yet — create new ones with `npx supabase migration new <name>`.

## Testing

- Vitest is the intended test runner but is **not yet installed**. Do not try to run or generate test commands.

## Git conventions

- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:` prefixes.
- Branch names follow the same prefixes: `feat/`, `fix/`, `chore/`.
- Default and CI branch is `master` (not `main`).
