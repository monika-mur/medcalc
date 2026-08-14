# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Deploy to Cloudflare Workers: `npm run build && NODE_TLS_REJECT_UNAUTHORIZED=0 npx wrangler deploy --config dist/server/wrangler.json`

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

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
