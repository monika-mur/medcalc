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

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill                          | Use it when                                                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code review (lesson focus)** |                                                                                                                                                                                                                                         |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome**   |                                                                                                                                                                                                                                         |
| `/10x-lesson`                  | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note.                                                                             |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
