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
- Migrations live in `supabase/migrations/`; create new ones with `npx supabase migration new <name>`. `npm run db:reset` re-applies them from scratch; `npm run db:types` regenerates `src/db/database.types.ts` (committed, never hand-edited).

## Testing

- `npm test` — Vitest integration tests (`tests/integration/`). **Requires a running local Supabase stack** (`npx supabase start`); the helper refuses to run against a non-local `SUPABASE_URL`, because these tests sign up users and write rows.
- `npm run db:test` — pgTAP database tests (`supabase/tests/`), run by `supabase test db` against the local database.
- Database-level invariants (RLS, CHECK, FK, uniqueness) belong in `supabase/tests/`. Behaviour on the client path — anything that goes through PostgREST or `@supabase/supabase-js` — belongs in `tests/integration/`.
- Both layers earn their keep: pgTAP catches a broken constraint, the integration suite catches a policy targeting the wrong role. A `check ((x = 'a') = (p and q))`-shaped constraint passed pgTAP and was caught by the integration suite; write presence constraints as `CASE`, and assert the partially-populated case in both.

## Domain schema

- **Dosage lives only in `dosage_changes`; quantity lives only in `supply_events` deltas.** Never add a cached `daily_dosage` or `quantity_on_hand` column to `medications` — the absence of a second copy is what makes drift impossible.
- **`supply_events` is append-only, and `dosage_changes` is immutable once effective** (deletable only while `effective_date > current_date`). Corrections are new rows — an `adjustment` event, or a later dosage change — never an UPDATE.
- **`medications` cannot be deleted** by policy; archival is `archived_at` (FR-007). Under RLS a DELETE with no policy matches zero rows rather than raising, so tests assert the row survives.
- **The schema carries no triggers, no database functions, and no RPC by design.** New invariants belong in CHECK / FK / UNIQUE / RLS. Reaching for a trigger or an RPC is a signal to re-plan, not to write one — the no-procedural-code property is asserted as a test.
- **A recount insert must supply `quantity_delta` itself**, alongside `counted_quantity` and `projected_quantity`. Nothing computes it server-side; a CHECK holds `quantity_delta = counted_quantity − projected_quantity` and rejects a row where the three disagree. The discrepancy signal is `quantity_delta <> 0` on a recount row.
- **The liquid sub-type is nullable columns on `medications`** (`container_capacity`, `estimated_daily_consumption`, `post_opening_expiry_days`, `opened_on`) guarded by a CHECK, so creating one is a single insert. A second sub-type is the signal to revisit that — not a reason to add nullable columns for it.
- **`daily_dosage = 0` means "stopped, keep the history"** and is distinct from archival, which hides the medication. A medication with no `dosage_changes` rows reads as dosage 0; one with no `supply_events` rows reads as quantity 0. Both are legal states, which is what makes a partial multi-statement create harmless.
- **Consequently the supply-end date is undefined, not computed, when dosage is 0** — never divide by it. A `5 → 0 → 5` series is three segments with zero consumption in the middle, not a gap to skip.
- **Current-state views** (latest dosage + current balance) are to be created once, at first need in S-04, and reused — not reimplemented per slice.

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

| Skill                                  | Use it when                                                                                                                                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Change setup (lesson focus)**        |                                                                                                                                                                                                                                                                      |
| `/10x-new <change-id>`                 | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`.               |
| **Planning (lesson focus)**            |                                                                                                                                                                                                                                                                      |
| `/10x-plan <change-id>`                | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-plan-review <change-id>`         | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin.                                                                          |
| **Implementation (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`.                                                                                                                          |
| **Lifecycle closure**                  |                                                                                                                                                                                                                                                                      |
| `/10x-archive <change-id>`             | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state.                                                                                                                                                             |

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
