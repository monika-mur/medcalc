# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**The shell here is PowerShell, which has no `VAR=value command` prefix.** Behind the corporate TLS-intercepting proxy, any command that reaches Supabase or Cloudflare needs `NODE_TLS_REJECT_UNAUTHORIZED=0` — set it as its own statement, once per session, not as a prefix:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

It then applies to every command in that session. Needed for `supabase login｜link｜db push｜migration list` and `wrangler deploy｜secret put`; not for purely local commands (`supabase logout`, `npm run lint`). Write commands for PowerShell when handing them to a developer — the bash prefix form works in Git Bash and CI, which is why it keeps getting written by mistake.

**The same proxy breaks other tools, each with its own flag** — `NODE_TLS_REJECT_UNAUTHORIZED` only reaches Node. `curl` needs `-k`; without it a perfectly healthy endpoint returns `HTTP 000` and reads as "unreachable" rather than as a TLS failure. Confirmed against the deployed Worker: `curl https://medcalc.medcalc.workers.dev` → `000`, `curl -k` → `200`. Before concluding a host is down, retry with the tool's insecure flag.

- Deploy to Cloudflare Workers: `npm run build && npx wrangler deploy --config dist/server/wrangler.json` (with the env var set as above)
- Deployed app: `https://medcalc.medcalc.workers.dev` (account subdomain `medcalc`, worker `medcalc`). The `medcalc-preview` environment in `wrangler.jsonc` has never been deployed — `ci.yml` only fires it on pull requests.

## Environment setup

Copy `.env.example` to both `.env` and `.dev.vars`, then fill in real values — `.env.example` ships placeholders, never live credentials.

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

## API conventions

- **Routes a browser navigates to as a form target redirect; routes called by client-side `fetch` return JSON.** Both conventions are live and both stay. Auth submits (`/api/auth/*`) happen before a session exists and must work with JavaScript disabled, so they are native `<form method="POST" action=…>` targets and redirect back with `?error=`. Domain CRUD happens inside an authenticated, hydrated page, so it is `fetch`-driven and returns JSON. Pick by which of those a new route is, not by whichever neighbouring route you read first.
- **The JSON error shape is `{ error: { message, fieldErrors? } }`**, where `fieldErrors` maps a field name to one message. Helpers live in `src/lib/api/json.ts` — use `jsonError`, not a hand-rolled `Response`. Statuses: **400** validation or malformed body, **401** unauthenticated, **404** not found, **409** blocked by references, **500** otherwise. Success returns the affected row (201 on create), or **204** for DELETE.
- **Guard `request.json()` in `try`/`catch`** (`readJsonBody`). A malformed body must produce a 400 in the contract's shape, not an unhandled 500.
- **Only parsed zod output reaches a data module** — never the raw request body, and never a spread of it. See the `updated_at` rule under _Domain schema_.
- **Data modules live in `src/lib/db/<entity>.ts`**, take a `SupabaseClient` as their first argument so a test can pass an authenticated client directly, and **never filter by `user_id`** — RLS does that, and a redundant filter would hide a policy regression. They return a `Result<T>` discriminated union and map Postgres error codes to domain error kinds; a raw Postgres message never reaches a response.
- **Zero rows is not an error, so 404 has to be detected.** Under RLS an UPDATE or DELETE against a missing or foreign `id` matches zero rows and returns success. Chain `.select()` onto both statements and treat an empty result array as not-found; without it, a PATCH against a stranger's row returns 200 and a DELETE returns 204.

## Design conventions

- **White/slate surfaces with green as a rationed accent.** Green means primary action, active, or healthy; red means destructive or error; everything else is neutral. A screen where green is a background is a screen where green has stopped meaning anything.
- **Colour comes from the `:root` tokens in `src/styles/global.css`**, because `components.json` sets `cssVariables: true`. Use `bg-primary` / `text-primary` / `border-input`; do not hardcode `green-*` in a component. Needing to edit a file in `src/components/ui/` to change a colour means the token is wrong.
- **`green-700` for anything with a letter in it, `green-600` for rings and borders.** `green-600` on white is 3.26:1 — it passes the 3:1 threshold for non-text UI and fails the 4.5:1 threshold for text. Never use `green-500` for text at any size.
- **`--input` is deliberately darker than `--border`** (slate-400 vs slate-200). An input's border is a UI-component boundary that must be identifiable; a card edge and the topbar rule are decorative and exempt under WCAG 1.4.11. Do not "fix" the divergence by re-unifying them.
- **Only `:root` is live.** The `.dark` block in `global.css` is dead — nothing sets `class="dark"` and there is no dark mode. Leave it alone rather than tuning it; a slice that wants dark mode starts by populating it.

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
- **`updated_at` has no maintainer and is client-writable.** `default now()` fires on INSERT only and no trigger or application code touches it, so it currently equals `created_at` on every row. The UPDATE policies constrain no columns and `database.types.ts` exposes it on both `Insert` and `Update`, so a client can set it to any value — including the past. Whoever gives it a maintainer (S-01) must pair the write path with a `check (updated_at >= created_at)`; the application setting it on every write is not enforcement on its own.
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
