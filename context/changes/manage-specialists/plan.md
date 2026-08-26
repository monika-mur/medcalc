# Manage Specialists (S-01) Implementation Plan

## Overview

Deliver the first user-facing domain slice: a `/specialists` screen where the user adds a specialist (name, specialty), sees their list, edits an entry, and deletes one that has nothing assigned to it. FR-003 exists because reliable medication↔visit linkage needs a managed entity — inconsistent spelling of specialist names breaks the core calculation.

The feature is small; its consequences are not. This is the first consumer of the F-01 schema, so it establishes the data-access module shape, the JSON API error contract, the validation approach, and the list-rendering pattern that S-02, S-03, and S-04 will copy.

## Current State Analysis

**The schema is complete and idle.** `specialists` (`supabase/migrations/20260813185255_domain_schema.sql:35-48`) carries `name` and `specialty`, both guarded by non-blank-after-trim CHECKs, plus `specialists_id_user_id_key` as the composite-FK target children use to prove shared ownership. It is the only table in the schema with all four RLS policies (`:265-273`) — SELECT, INSERT, UPDATE and DELETE are already granted to `authenticated` over own rows. Nothing at the data layer needs to be added for CRUD to work.

**No domain surface exists.** `src/pages/api/` holds only `auth/{signin,signup,signout}.ts`. `src/pages/dashboard.astro` is a placeholder that prints `user?.email` and a sign-out button. `src/lib/` has `supabase.ts`, `config-status.ts`, and `utils.ts` — no `db/` directory. This slice creates the first non-auth route, page, component directory, and data module.

**The established form pattern is a full-page POST.** `signup.astro:16` mounts a React island with `client:load`; the island renders a native `<form method="POST" action="/api/auth/signup">`; the route redirects back with `?error=`. There is no `fetch`, no JSON, and no client state after submit. **This slice deliberately diverges** — see "Two API conventions, one rule" below.

**shadcn is configured but nearly unused.** `components.json` declares `new-york` style with `@/components/ui` as the target, but `src/components/ui/` holds only `button.tsx`. Critically, it also declares `cssVariables: true` and `baseColor: neutral`, so every shadcn primitive reads its colour from the token block in `src/styles/global.css:6-39` — `button.tsx` styles itself as `bg-primary text-primary-foreground` and never names a colour directly. **The palette is therefore a token edit, not a per-component rewrite.**

**The current look is a dark cosmic/glassmorphism theme, and it is not in `Layout.astro`.** `Layout.astro` is bare — it imports the stylesheet, renders config banners, and slots. The theme lives in two places: the `bg-cosmic` utility (`global.css:113-115`, a near-black gradient) and per-page glass classes at `src/pages/auth/signin.astro:9-10`, `signup.astro:9-10`, `confirm-email.astro:22-24`, `dashboard.astro:8-20`, `Welcome.astro:5,49,58,80,103`, `Topbar.astro:6`, and `FormField.tsx:6`. `Topbar.astro` additionally carries a purple accent (`text-purple-300`). The `.dark` token block at `global.css:41-73` is dead — nothing in the repo ever sets `class="dark"`, so the app is always in `:root`.

**Deleting a specialist in use is already blocked at the database.** `medications_specialist_fk` (`:116-118`) and `visits_specialist_fk` (`:216-218`) are `ON DELETE RESTRICT`, so the DELETE that RLS permits will still raise `23503` when anything references the row. No application code handles that today.

**Two tracked debts land in this slice.** `updated_at` has no maintainer and is client-writable — F-01's plan review deferred the decision to S-01 by name, and impl-review F8 added the client-writability half. Review finding F4 (wrap `auth.uid()` in policies, add missing `user_id` indexes) targets these same policies.

### Key Discoveries

- `specialists` has full CRUD RLS already — `supabase/migrations/20260813185255_domain_schema.sql:265-273`
- Composite FK means a child row can never point at another user's specialist — `:116-118`, `:216-218`
- `FormField` already handles label, icon, error and hint via a stable props API — `src/components/auth/FormField.tsx:22-34`
- The signup timezone capture depends on a hidden `input[name="timezone"]` being present and uncontrolled — `SignUpForm.tsx:135`, `signup.astro:31-36`
- `PROTECTED_ROUTES` is the single place new protected paths are registered — `src/middleware.ts:4`
- The integration suite authenticates via `createAuthenticatedClient(label)` and refuses a non-local `SUPABASE_URL` — `tests/integration/helpers/client.ts:41`, `:22-28`
- Generated types already expose `specialists` Row/Insert/Update — `src/db/database.types.ts:128-154`

## Desired End State

A signed-in user visits `/specialists` and sees their specialists rendered on first paint with no loading flash. They can add one with inline validation, edit one in place, and delete one — with the delete control disabled and explained when medications or visits still reference it. An unauthenticated visitor to `/specialists` is redirected to sign-in. The whole flow works at a 320 px viewport without horizontal scrolling.

Across the app, one visual system: white and slate surfaces with green as a rationed accent, carried by the `:root` design tokens rather than per-component classes, at AA contrast throughout. Every existing screen — landing, both auth screens, confirm-email, dashboard — has moved off the dark cosmic/glassmorphism theme, so `/specialists` arrives into a coherent app rather than establishing a second look. This is a deliverable of the slice, not a side effect of it: it is the largest surface change here, and Phase 2 is where it lands.

Underneath: `src/lib/db/specialists.ts` is the single place specialist queries live, a zod schema is the single definition of what valid input means, and `updated_at` is written on every update by the data module — constrained so it can never precede `created_at`, and never taken from a request body.

Verify by: signing in, exercising add/edit/delete against a seeded medication, walking every screen for one visual language at AA contrast, and running `npm test` plus `npm run db:test` green against a clean `npm run db:reset`.

## What We're NOT Doing

- **No medications, visits, or dashboard _functionality_.** S-02, S-03 and S-04 own those. This slice touches no other domain table except through the read-only usage counts the delete guard needs. The exception is visual: Phase 2 repaints `dashboard.astro` along with every other existing screen, because leaving one screen dark is what "two designs" means. Repainting it is not building it.
- **No specialist-detail page.** The list is the screen; edit happens in place.
- **No search, sort, filter, or pagination.** The PRD's persona tracks a handful of specialists; `target_scale.data_volume` is `small`.
- **No uniqueness constraint on specialist name.** Two entries named "Dr. Nowak" are legal — the user may genuinely see two. FR-003's concern is stable linkage by key, which the FK already provides.
- **No soft delete or archival for specialists.** FR-007's archival requirement is scoped to medications. A specialist with nothing assigned carries no history worth preserving.
- **No account-erasure work (F3).** It stays queued in `domain-schema-foundation/follow-ups/review-fixes.md`; it needs a local-stack rehearsal and it interacts with the delete guard decided here.
- **No component-test harness.** No `@testing-library/react`, no jsdom. The island's branching logic is covered by manual verification only — recorded as an accepted gap, not an oversight.
- **No test authoring at all in Phases 3 and 4** — decided 2026-08-26, mid-slice. Writing tests moves to a dedicated skill that is not yet installed, so `tests/integration/specialists.test.ts` is not created here and no pgTAP is added beyond Phase 1's. The existing suites still **run** as regression gates in both phases; running them is not authoring them. Phase 3 §5 keeps the full contract verbatim as the hand-off, flagged with which two assertions to write first. See "Accepted gap" for what this leaves unguarded — it is a real reduction in coverage, not a reshuffle.
- **No mirrored (per-table) grants.** Phase 1 grants all four DML privileges uniformly. Restricting them to match each table's policy set is strictly stronger, but it turns "zero rows affected" into `42501` and so requires rewriting `append_only.test.sql`, amending `CLAUDE.md`'s documented zero-rows rule, and revisiting Phase 3's error mapping. That is a real hardening change with its own blast radius, queued in `follow-ups/review-fixes.md` → S-05 — not a rider on a toolchain bump.
- **No cloud _writes_ of any kind.** Phase 1 does read-only reconnaissance against cloud — one `select` confirming its grants match what the migration will assert — because that read is what makes the eventual push a known no-op instead of a hope. Pushing the migration, and reconciling cloud if the read comes back wrong, both stay deliberate manual steps outside this plan, same boundary as every other cloud push here.
- **No CI changes.** Review finding F9 (CI gates neither suite, deploys to production on push) stays queued as its own change.
- **No migration push to cloud.** Phase 1's migration stays local. Pushing is a deliberate manual step, consistent with F-01's decision and `infrastructure.md:91`.
- **No dark mode.** The `.dark` token block in `global.css:41-73` stays dead — nothing in the repo sets `class="dark"` and no toggle is built. It is left in place rather than deleted (that would diverge from shadcn's expected file shape for no gain), but only `:root` is live. A future slice wanting dark mode starts by populating that block, not by discovering it half-done.
- **No visual-regression or automated accessibility tooling.** No Playwright screenshots, no axe in CI. The PowerShell scan in Phase 2 is the only mechanical check, and it can prove the old theme is gone but not that the new one is right. Contrast and layout are verified by hand at the criteria listed per phase. If the palette starts drifting across S-02/S-03/S-04, that is the signal to add tooling — not a reason to build it for one screen.

## Implementation Approach

Four phases, bottom-up, each independently verifiable:

1. **Schema** — settle `updated_at` and fold in F4, so the data layer is final before anything is built on it.
2. **Design system** — install the primitives and unify the visual language, so the new screens are built on their final form rather than restyled later.
3. **Data layer** — validation schema, data module, JSON routes, integration tests. Fully testable without any UI.
4. **UI** — the page, the island, navigation and route protection.

The ordering is deliberate: each phase's output is the next phase's input, and phases 1–3 are verifiable by automated checks alone.

## Critical Implementation Details

**Two API conventions, one rule.** The auth routes redirect with `?error=`; the specialists routes return JSON. Both stay. The rule that decides which to use, and that S-02/S-03 must follow: **routes that a browser navigates to as a form target redirect; routes called by client-side `fetch` return JSON.** Auth submits happen before a session exists and must work with JavaScript disabled, so they stay form-target routes. Domain CRUD happens inside an authenticated, hydrated page, so it is `fetch`-driven. Write this rule into `CLAUDE.md` in Phase 3 — an undocumented split will read as inconsistency to the next slice.

**The usage count may not be embeddable.** PostgREST resource embedding resolves relationships from foreign keys, and `medications_specialist_fk` is a _composite_ FK on `(specialist_id, user_id)`. An embed like `.select("*, medications(count), visits(count)")` may fail to resolve, or need the constraint name as a disambiguating hint. Try the embed first; if PostgREST cannot resolve it, fall back to selecting `specialist_id` from both tables and tallying in TypeScript. At this data volume (`target_scale.data_volume: small`, a handful of specialists and ≤20 medications) the fallback costs nothing measurable, and it is guaranteed to work. Do not reach for an RPC — the schema's no-procedural-code property is asserted as a test.

**The signup timezone capture is fragile in a specific way.** `signup.astro:31-36` finds `input[name="timezone"]` on submit and writes into it; `SignUpForm.tsx:135` renders that input uncontrolled with `defaultValue=""`. The comment there records that a mount-time write does _not_ survive, because `validate()`'s `setErrors` re-render resets it. Phase 2 restyles these forms — **the hidden input must remain present, uncontrolled, and named `timezone`**, and manual verification must confirm a real signup still stores the zone.

**Restyle by swapping internals, not call sites.** `FormField` has a stable props API (`id`, `label`, `type`, `value`, `onChange`, `error`, `hint`, `icon`, `endContent`). Rewriting its body to compose shadcn `Label` + `Input` while keeping that API means `SignInForm` and `SignUpForm` change only their import path. Those two files were edited on 2026-08-20 for impl-review F10 and have no component tests behind them, so minimising their diff is the point.

**Visual design direction: clinical white, green as a rationed accent.** The app reads as a medical record-keeping tool, so the target is calm and professional rather than branded: white and near-white surfaces, slate text, thin neutral borders, and green used only where it carries meaning. The existing dark cosmic/glassmorphism theme is replaced entirely — it reads as a consumer product and it fights the red the delete and error paths need.

The rule that keeps this consistent as S-02/S-03/S-04 are built: **green means "primary action, active, or healthy"; red means "destructive or error"; everything else is neutral.** A screen where green is a background is a screen where green has stopped meaning anything. Concretely:

| Role                 | Value                              | Where                                           |
| -------------------- | ---------------------------------- | ----------------------------------------------- |
| Page background      | `#F8FAFC` (slate-50)               | `body`                                          |
| Card / panel surface | `#FFFFFF`                          | list rows, form panels, auth card               |
| Primary text         | slate-900                          | headings, field values                          |
| Secondary text       | slate-600                          | labels, hints, specialty line                   |
| Border / divider     | slate-200                          | card edges, input borders, topbar rule          |
| Primary action       | **green-700 `#15803D`**            | filled buttons, text links                      |
| Primary hover        | green-800                          | —                                               |
| Focus ring           | green-600 `#16A34A`                | all focusable elements                          |
| Success / healthy    | green-600 (icon or text, on white) | confirmations                                   |
| Destructive          | red-600                            | delete button, error text, invalid field border |

**The green-700-not-600 split is a contrast requirement, not a taste call.** `green-600` on white is 3.26:1 — it passes the 3:1 threshold for non-text UI (focus rings, borders, icons) and fails the 4.5:1 threshold for text. `green-700` is 5.02:1 and passes AA. So: 600 for rings and borders, **700 for anything with a letter in it**, including white text on a green fill. Do not use `green-500` for text at any size.

**Contrast is checked, not assumed.** Phase 2 and Phase 4 each carry a manual verification step asserting AA (4.5:1 body text, 3:1 UI) on the screens they touch. A medication-supply tool that a user reads to decide when to reorder a prescription is exactly the case where low-contrast grey-on-white causes a real-world mistake.

**Implementation shape.** Because `components.json` sets `cssVariables: true`, the palette is expressed by rewriting the `:root` token block in `src/styles/global.css` — `--primary`, `--primary-foreground`, `--ring`, `--background`, `--card`, `--border`, `--muted-foreground`, `--destructive`. Every shadcn primitive then inherits it with no edit. **Do not hardcode `bg-green-700` in components**; use `bg-primary` and let the token carry it, so a future palette change stays one file. Hand-written Astro markup that predates shadcn (`Topbar.astro`, the page wrappers) may use Tailwind's slate/green scale directly, but must match the values in the table above.

**The `.dark` block is out of scope.** Nothing toggles it and no dark mode is planned for the MVP. Leave the block in place and untouched rather than deleting it — deleting it is a change to shadcn's expected file shape that buys nothing. Note in the CLAUDE.md subsection (Phase 3) that only `:root` is live, so a future slice does not waste effort tuning dead tokens or assume dark mode works.

## Phase 1: Schema — explicit grants, `updated_at` guard, and F4 policy rewrite

### Overview

One migration that makes the schema's table privileges explicit, settles the deferred `updated_at` decision, and folds in review finding F4. Behaviour-neutral for F4 and for the grants; additive for the CHECK. No rows exist in any environment, so nothing can be rejected retroactively.

**Why grants are suddenly in scope.** `20260813185255_domain_schema.sql` issues no `GRANT` at all — verified by grep, where the only matches are two comments. It has always depended on the Supabase platform's historical default of granting DML on new `public` tables to `anon` and `authenticated`. That default changed. The Postgres image bundled with CLI 2.115.0 ships a restricted default ACL for the `postgres` role in `public`:

```
public | supabase_admin | r | authenticated=arwdDxtm   <- full DML
public | postgres       | r | authenticated=Dxtm       <- no a/r/w/d
```

Migrations run as `postgres` and the five domain tables are owned by `postgres`, so on a freshly reset local stack they carry only `TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` — and every table is unreachable to `authenticated`. pgTAP drops from 57/57 to 14/57 with `permission denied` on four of five tables. RLS policies do not grant privileges; a working table needs **both** a `GRANT` and a permissive policy, and this schema only ever had the second.

This is a latent defect in F-01, not a consequence of the CLI upgrade — the upgrade only surfaced it, which is fortunate timing given S-01 is about to build a data module, four routes, and an integration suite on top. It also means **local and cloud have diverged**: the cloud project was created under the old permissive default and is expected to still work. That is unverified and worth checking before the next cloud push, but it is not this slice's job.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<timestamp>_grants_updated_at_guard_and_rls_perf.sql` (create with `npx supabase migration new grants_updated_at_guard_and_rls_perf`)

**Intent**: Make the table privileges explicit rather than inherited, make `updated_at` unable to precede `created_at` on the three tables that carry it, and apply F4's performance rewrite while the policy set is small enough to change in one pass.

**Contract**:

- **Explicit `GRANT` of all four DML privileges on all five domain tables to `authenticated`**, and to `authenticated` only:

  ```sql
  grant select, insert, update, delete on public.specialists    to authenticated;
  grant select, insert, update, delete on public.medications    to authenticated;
  grant select, insert, update, delete on public.dosage_changes to authenticated;
  grant select, insert, update, delete on public.supply_events  to authenticated;
  grant select, insert, update, delete on public.visits         to authenticated;
  ```

  **No grants to `anon`, and the matching `revoke` is issued explicitly** on all five tables. The app has no anonymous data access — every policy is `to authenticated`, and an anonymous visitor reaching a domain table is a bug in the middleware, not a supported path. There are no sequences to grant (all primary keys are `gen_random_uuid()`).

  The `revoke` was added on 2026-08-25, after step 1.8 found the cloud project carrying the older platform default's `anon` grants on all five tables — 10 rows in `role_table_grants` where local has 5. RLS holds (as `anon`: SELECT returns 0 rows, INSERT raises the RLS violation, DELETE reports 0), so this is a defence-in-depth gap rather than a breach. But `GRANT` alone would leave cloud at 10 and local at 5 permanently, making the `anon` assertions true locally and false in production — the exact drift this migration exists to end. The `revoke` is a no-op locally and converges cloud on push. It is unrelated to the mirrored-grants question deferred to S-05, which concerns withholding privileges from `authenticated`; no suite runs as `anon`, so nothing observable changes.

- **The grants are deliberately uniform, not mirrored to each table's policy set.** Restricting them per-table — `medications` without `DELETE`, `supply_events` without `UPDATE`/`DELETE` — is strictly stronger and was measured: it leaves pgTAP at 44/57. `append_only.test.sql` fails, and its header comment explains exactly why the design depends on the looser grant:

  > a command with RLS enabled and NO policy is not an error. It matches zero rows and returns success. So every assertion below checks the AFFECTED ROW COUNT and the survival of the row — never that an exception was raised. Asserting `throws_ok` here would pass for the wrong reason.

  Withholding the privilege turns "zero rows affected" into `42501 permission denied`, which changes the observable contract that the tests, `CLAUDE.md`, and Phase 3's error mapping all encode. The uniform set restores exactly the pre-existing documented behaviour and was verified at **57/57**. Tightening to mirrored grants is real hardening and is queued as its own change — see `follow-ups/review-fixes.md` → S-05. It does not ride along here as a side effect of a toolchain bump.

- `check (updated_at >= created_at)` added to `specialists`, `medications`, and `visits`. Name each `<table>_updated_at_not_before_created_at`.
- All 16 RLS policies rewritten from `auth.uid() = user_id` to `(select auth.uid()) = user_id`. There are **19** bare occurrences across `USING` and `WITH CHECK` clauses (`:266-314`) and zero wrapped ones. Use `alter policy` rather than drop-and-recreate so no window exists where a table is unprotected.
- **The 5 `default auth.uid()` column clauses (`:37`, `:61`, `:133`, `:163`, `:210`) are deliberately excluded**, as are the 2 mentions in the header comment (`:13-14`). 26 occurrences exist in the file; only the 19 in policy predicates are in scope. A column default is evaluated once per inserted row regardless, so the initplan optimisation F4 is buying does not apply there — wrapping them would edit table DDL for no benefit. If a count of rewritten predicates comes out above 19, something outside the policy block was touched.
- `create index dosage_changes_user_id_idx on public.dosage_changes (user_id)` and the same for `supply_events`. Both are currently indexed on `(medication_id, …)` only, while RLS injects a `user_id` predicate into every read.
- Header comment stating that F4's rewrite is behaviour-identical, that the grants replace an inherited platform default rather than widening access, and that the existing suites are the regression net.

#### 2. pgTAP coverage for the new constraint and the grants

**File**: `supabase/tests/constraints.test.sql`

**Intent**: Assert the new CHECK rejects a backdated `updated_at`, at the layer that enforces it.

**Contract**: Three `throws_ok` assertions with errcode `23514` — one per table — updating a seeded row to set `updated_at` earlier than `created_at`. Use the 4-argument form with a `null` message; the 3-argument form matches the third argument against the raised message, which is the trap recorded in `change.md` for `domain-schema-foundation`. Bump the file's plan count from 15 to 18.

**File**: `supabase/tests/rls.test.sql`

**Intent**: Assert the grants exist, so the schema can never again silently depend on a platform default.

**Contract**: Ten assertions, two per domain table, placed **before** the `set local role authenticated` switch so they run as `postgres`. Each asserts, against `information_schema.role_table_grants` filtered to the four DML privileges, that `authenticated` holds `DELETE,INSERT,SELECT,UPDATE` and that `anon` holds none of the four. Bump the file's plan count from 15 to 25.

Originally six assertions, with the `anon` half covering `specialists` only. Extended to all five tables on 2026-08-25: step 1.8 found cloud carrying `anon` grants on every table, so a single-table assertion would have gone green while four tables stayed exposed to the same defect.

The point is not that DML is permitted — the other suites already prove that indirectly — but that the privilege is **stated by a migration** rather than inherited. That is precisely the property whose absence took the suite from 57/57 to 14/57 on an image bump, and nothing in the repo previously noticed it.

**Not `table_privs_are`**, which the first draft of this plan specified. That function asserts the **exact** privilege set, and `authenticated` also holds `REFERENCES`, `TRIGGER`, and `TRUNCATE` from the platform's default ACL — a probe with just the four DML fails with `Extra privileges: REFERENCES, TRIGGER, TRUNCATE`. Listing all seven to make it pass would hard-code the inherited default into the assertion, which is the exact dependency this phase exists to remove, and would break spuriously on the next image change. The filtered query also matches the manual-verification step and the cloud query verbatim, so the automated and manual checks cannot drift apart.

#### 3. Regenerated types

**File**: `src/db/database.types.ts`

**Intent**: Keep the committed types in step with the schema.

**Contract**: Regenerate with `npm run db:types`. A CHECK, an index, and a `GRANT` change no generated types, so **this file is expected not to change** — a diff here means something unintended landed in the migration and should be investigated before proceeding.

### Success Criteria:

#### Automated Verification:

- Migration applies from scratch: `npm run db:reset`
- pgTAP passes at **70 assertions** — the prior 57 plus 3 for the CHECK and 10 for the grants: `npm run db:test`
- **The grants survive a from-scratch reset**, which is the whole point: `npm run db:reset` followed immediately by `npm run db:test` must be green with no manual `GRANT` in between. The ad-hoc grants applied while diagnosing this are wiped by the reset, so a green run here proves the migration is carrying them
- Generated types are unchanged: `npm run db:types` leaves `src/db/database.types.ts` with no diff
- Linting passes: `npm run lint`

#### Manual Verification:

- In Studio, an UPDATE setting `updated_at` before `created_at` is rejected on each of the three tables
- `authenticated` holds SELECT/INSERT/UPDATE/DELETE on all five domain tables and `anon` holds none, confirmed by querying `information_schema.role_table_grants` after a clean reset
- **The same query run against the cloud project returns the same five rows.** This is read-only reconnaissance, not a push — see "Verifying cloud" below for why it belongs in this phase and what a mismatch means
- `npx supabase migration list` shows the new migration as local-only — this slice does not push to cloud

### Verifying cloud

The grants are the first change in this slice whose correct behaviour differs by environment, so the assumption behind them gets checked rather than carried. Locally they **restore** access a newer Postgres image withdrew. On cloud they are expected to be a **no-op**: that project was created under the older permissive default, already holds the same privileges, and `GRANT` is idempotent.

That expectation is currently unverified, and it is load-bearing — it is the reason this migration is safe to push later without a maintenance window. Verify it in this phase, while the migration is fresh and nothing depends on it yet, rather than at push time when the cost of being wrong is highest.

Run in the cloud project's SQL Editor (dashboard → SQL Editor), which needs no local credential wiring:

```sql
select table_name,
       string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'authenticated'
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
group by table_name
order by table_name;
```

Expect five rows, each reading `DELETE, INSERT, SELECT, UPDATE`. Interpret the result as follows:

- **Five complete rows** — the assumption holds. The migration is a no-op on cloud and can be pushed whenever the slice ships. Record the date checked in `change.md`; a platform default can change again.
- **Missing rows or missing privileges** — cloud is already broken in the same way local was, and the live app is running on borrowed privileges that could disappear at any time. **Stop and re-plan the push**: it becomes a fix with urgency rather than a no-op, and it should go out on its own rather than waiting behind four phases of UI work.
- **Extra grants, or grants to `anon`** — something outside these migrations touched the cloud schema. Do not paper over it with a migration; find out what did it first.

If you prefer the CLI to the dashboard, remember the proxy and the shell (`lessons.md` → _Write shell commands for PowerShell_) — set the variable as its own statement, never as a prefix:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Design system — primitives and auth restyle

### Overview

Install `zod` and the shadcn primitives the forms need, repaint the design tokens to the white/green palette, and unify the visual language by rewriting `FormField`'s internals. Sequenced before the new screens so those are built on final primitives rather than restyled afterwards.

This phase is larger than it first reads, because dropping the cosmic/glassmorphism theme touches every existing page, not just the auth screens. That is the cost of doing it once: the alternative is Specialists shipping white-and-green next to a dark dashboard, and a later slice paying the same bill with more screens in it.

### Changes Required:

#### 0. Design tokens

**File**: `src/styles/global.css`

**Intent**: Express the palette once, in the token block every shadcn primitive already reads, so no component hardcodes a colour.

**Contract**: Rewrite the `:root` block (`:6-39`) to the values in the "Visual design direction" table — `--background` slate-50, `--card` white, `--foreground` slate-900, `--muted-foreground` slate-600, `--border` and `--input` slate-200, `--primary` green-700, `--primary-foreground` white, `--ring` green-600, `--destructive` red-600. Express them in `oklch()` to match the file's existing notation.

Delete the `bg-cosmic` utility (`:113-115`) — every call site is removed in this phase, and leaving a dead dark-gradient utility invites a future slice to reach for it. Leave the `.dark` block (`:41-73`) untouched; see "The `.dark` block is out of scope" above.

`button.tsx` and the primitives installed in step 1 must **not** be edited — if a colour looks wrong, the token is wrong. Needing to touch a `ui/` file is the signal that this step is incomplete.

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the validation library and the UI primitives this slice and the next three depend on.

**Contract**: `npm i zod`. Then `npx shadcn@latest add input label card alert-dialog` — `input` and `label` for the forms, `card` for list items, `alert-dialog` for the delete confirmation. `button` already exists. Components land in `src/components/ui/` per `components.json`.

#### 2. Shared form field

**File**: `src/components/form/FormField.tsx` (moved from `src/components/auth/FormField.tsx`)

**Intent**: Make the field component reusable across domain screens and re-implement it on shadcn primitives, without changing the API its two existing callers depend on.

**Contract**: Same exported props (`id`, `name?`, `label`, `type?`, `value`, `onChange`, `placeholder?`, `error?`, `hint?`, `icon`, `endContent?`), composing shadcn `Label` and `Input`. Two changes to the API: `icon` becomes optional, since domain forms have no natural icon per field; error state continues to be conveyed both visually and via the rendered message. Delete the old file.

The glass input styling at `FormField.tsx:6` (`bg-white/10 border … text-white placeholder-white/40`) goes entirely — the shadcn `Input` reads `--input`/`--ring` and needs no colour classes. Error state is a red-600 border plus the message; **the message is what conveys the error**, since colour alone fails on the accessibility check this phase now carries.

#### 3. Auth form imports

**Files**: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`

**Intent**: Point at the moved component. No other change.

**Contract**: Import path only — `@/components/form/FormField`. The hidden `<input type="hidden" name="timezone" defaultValue="" />` at `SignUpForm.tsx:135` must remain present, uncontrolled, and unrenamed; the inline script in `signup.astro` selects it by name at submit time.

#### 4. Surrounding chrome

**Files**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/pages/dashboard.astro`, `src/components/Topbar.astro`, `src/components/auth/ServerError.tsx`, `src/components/auth/SubmitButton.tsx`, `src/components/auth/PasswordToggle.tsx`; **replaced**: `src/components/Welcome.astro`; **deleted**: `src/components/ui/LibBadge.astro`

**Intent**: Bring every existing screen onto the white/green surface treatment, so the app reads as one design rather than two. The file list is wider than the auth screens because `bg-cosmic` and the glass classes are spread across all of them — the grep in "Current State Analysis" is the definitive list of call sites to clear.

**Contract**: Restyle only. No change to markup structure that the inline timezone script or the native form POST depends on: the `<form method="POST" action=…>` element, its field `name` attributes, and the submit button's `type="submit"` all stay as they are.

Specifics beyond a straight colour swap:

- **`Topbar.astro`** drops the purple accent (`text-purple-300`, `text-blue-100/70` at `:12-15` and the signed-out branch) for slate-600 text with green-700 links. It becomes a white bar with a slate-200 bottom border rather than a floating translucent pill — it is the one piece of chrome the new Specialists screen sits under, and step 4 of Phase 4 depends on its final form.
- **`Welcome.astro` is replaced, not restyled.** It is ~110 lines of starter marketing content — three glass feature cards, a dependency-version badge strip, links to the starter's docs — rendered at `/` through `index.astro`. Repainting markup that gets deleted the moment MedCalc has a real landing page is effort that does not compound, and it is very likely more work than writing the replacement. Replace the body with a minimal signed-out landing: the product name, one sentence on what MedCalc does, and `Sign in` / `Sign up` buttons (primary and outline). Keep the file at its current path so `index.astro` needs no edit, and pass a real `title` to `Layout` — it defaults to `"10x Astro Starter"` today.
- **`src/components/ui/LibBadge.astro` is deleted** as part of that replacement. It exists only to render dependency-version chips inside `Welcome.astro` and carries `bg-blue-900/50` / `text-purple-200` styling with no place in the new palette. It is starter boilerplate that happens to sit in `ui/`, not a shadcn primitive — step 0's "do not edit anything in `ui/`" rule covers generated primitives, and this is the one file it does not apply to. Confirm it has no other importer before deleting.
- **`SubmitButton.tsx`** should render the shadcn `Button` (`variant="default"`, which is now green-700) rather than carrying its own classes, so the primary action is identical everywhere.
- The full-screen wrappers that read `bg-cosmic` become `bg-background`; the glass cards (`bg-white/10 … backdrop-blur-xl`) become `bg-card border border-border` with a soft shadow.

**Verification aid**: a repo scan for surviving dark-theme classes is the objective completion test for the restyle. Run it in PowerShell — the developer's shell has no `grep`, per `lessons.md` → _Write shell commands for PowerShell_:

```powershell
Get-ChildItem src -Recurse -Include *.astro,*.tsx |
  Where-Object { $_.FullName -notmatch 'components\\ui' } |
  Select-String -Pattern 'bg-cosmic|backdrop-blur|bg-white/|border-white/|purple-'
```

No output means the step is done. Two deliberate exclusions:

- **`src/components/ui/` is skipped.** shadcn's generated primitives carry their own utility classes — `button.tsx:14` has `bg-destructive text-white` in the destructive variant — and step 0 forbids editing them. Scanning them would make the gate unpassable by design.
- **`text-white` is not in the pattern.** A green filled button legitimately renders white text through `--primary-foreground`, so the string is expected to survive in the primitives and in any hand-written markup sitting on a green fill. `bg-cosmic` and the `*-white/` alpha variants are the actual signatures of the old theme.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check` reports 0 errors and 0 warnings
- Build passes: `npm run build`
- No dark-theme remnants: the PowerShell `Select-String` scan in step 4 returns no output

#### Manual Verification:

- Sign-in and sign-up render correctly and both still submit successfully against the local stack
- A real signup still stores the browser timezone in `raw_user_meta_data` — this is the regression the restyle is most likely to cause
- Server-side error display still works: submit a duplicate email and confirm the message renders
- Both screens are usable at a 320 px viewport with no horizontal scrolling
- Every screen renders on white/slate surfaces with green only on primary actions, links, and focus rings — no dark background survives on `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/dashboard`
- Contrast passes AA on the auth screens and dashboard: body and label text ≥ 4.5:1, focus rings and borders ≥ 3:1. Check the green-on-white and slate-600-on-white pairs specifically, via devtools' contrast readout or an axe/Lighthouse accessibility pass
- Keyboard focus is visible on every interactive element — the green-600 ring replaces a glass hover affordance that was partly carrying this before
- The replaced landing page at `/` renders, names the product rather than the starter, and its `Sign in` / `Sign up` buttons reach the right routes; the browser tab no longer reads "10x Astro Starter"

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Data layer — validation, module, JSON routes, tests

### Overview

Everything behind the UI: one zod schema, one data module, and four routes.

**The integration suite that was to accompany them is deferred** — see §5. That changes what "verifiable" means for this phase: the automated criteria now prove the phase compiles, lints, and breaks nothing pre-existing, but they prove nothing about the behaviour the phase adds. Manual step 3.5 and the new 3.6 are the only checks on that, so they are not a formality here.

### Changes Required:

#### 1. Validation schema

**File**: `src/lib/validation/specialist.ts`

**Intent**: Define once what a valid specialist input is, for both the island and the route to import.

**Contract**: A zod object over `name` and `specialty`. Both trimmed, minimum length 1 after trimming — mirroring `specialists_name_not_blank` and `specialists_specialty_not_blank` — and capped at 120 characters. The cap has no database counterpart: the review noted these columns are unbounded `text`, and the client is the only place a bound currently exists. Export the schema plus its inferred input type.

#### 2. Data module

**File**: `src/lib/db/specialists.ts`

**Intent**: The single place specialist queries live, called by both the Astro page and the API routes. This is the pattern S-02/S-03/S-04 copy.

**Contract**: Functions taking a `SupabaseClient` (the type already exported from `src/lib/supabase.ts:34`) as first argument, so tests can pass an authenticated test client directly:

- `listSpecialists` — returns rows ordered by `name`, each with a usage count of referencing medications and visits. See "The usage count may not be embeddable" above for the embed-versus-tally decision.
- `createSpecialist` — inserts; relies on `user_id DEFAULT auth.uid()` rather than passing it, matching the schema's design.
- `updateSpecialist` — updates name/specialty **and sets `updated_at` to now**. This is the maintainer decision F-01 deferred to this slice.
- `deleteSpecialist` — deletes, mapping Postgres `23503` to a domain error meaning "still referenced". Do not surface the raw Postgres message.

No function filters by `user_id`; RLS does that, and adding a redundant filter would hide a policy regression from the tests.

**The update payload is constructed explicitly, never spread from the request body.** `updateSpecialist` builds `{ name, specialty, updated_at: new Date().toISOString() }` from the parsed zod output and passes that object to `.update()`. It must not accept a caller-supplied `updated_at`, and must not do `.update({ ...input })` over anything that reached it from a request.

This is load-bearing, not stylistic. Phase 1's `check (updated_at >= created_at)` closes only the backdating half of impl-review F8: the UPDATE policies constrain no columns, and `database.types.ts` exposes `updated_at` on `Update`, so a client can still set it to any **future** value. Spreading a request body into `.update()` would make this new JSON API a more convenient route to the exact defect the slice claims to close. There is no database-level alternative to check against — revoking column UPDATE from `authenticated` would block the module's own write, since it runs as that same role, and a trigger is ruled out by the schema's no-procedural-code property. The application path is the only lever, which is why it is specified here rather than left to habit.

**With test authoring deferred (see §5), nothing automated holds this rule.** It was to be asserted in `tests/integration/specialists.test.ts`; until that lands, the only checks are this specification, code review, and manual step 3.5. Treat a `.update({ ...input })` appearing anywhere on this path as a defect regardless of whether anything currently fails.

The same rule applies to `createSpecialist`: `created_at`, `updated_at`, `id`, and `user_id` all come from column defaults and are never passed.

#### 3. API routes

**Files**: `src/pages/api/specialists/index.ts` (GET, POST), `src/pages/api/specialists/[id].ts` (PATCH, DELETE)

**Intent**: Expose the module over JSON for the hydrated island.

**Contract**: Each handler resolves the client via `createClient(context.request.headers, context.cookies)`, returns 401 when `context.locals.user` is absent, validates the body with the zod schema, and delegates to the module.

The JSON error contract, which S-02 and S-03 must reuse: a failure responds with the appropriate status and a body of `{ error: { message, fieldErrors? } }`, where `fieldErrors` maps field name to message. Statuses: 400 validation, 401 unauthenticated, 404 not found, 409 delete blocked by references, 500 otherwise. Success responds with the affected row, or 204 for DELETE.

Only the parsed zod output is forwarded to the module — never the raw parsed JSON. See the update-payload rule in §2; the route is the other place that rule can be broken.

**How 404 is detected, since nothing raises it.** Under RLS an UPDATE or DELETE against a missing `id` — or against another user's row — matches zero rows and returns success with no error. `CLAUDE.md` already records this for DELETE: "a DELETE with no policy matches zero rows rather than raising." So the module chains `.select()` onto both statements and treats an empty result array as not-found, which the route maps to 404. Without this, a PATCH against a stranger's specialist returns 200 and a DELETE returns 204, and the cross-user isolation test still passes because it only asserts the row survives.

Guard `request.json()` in `try`/`catch` — a malformed body must produce a 400 in the contract's shape, not an unhandled 500. This mirrors the `formData()` fix applied to the auth routes for impl-review F10.

#### 4. Documented convention

**File**: `CLAUDE.md`

**Intent**: Record why two API conventions coexist, so the next slice follows the rule instead of copying whichever route it happens to read first.

**Contract**: A short subsection stating the rule from "Two API conventions, one rule" above, plus the JSON error shape and its status codes. Also note that data modules live in `src/lib/db/<entity>.ts`, take a client as first argument, and never filter by `user_id`.

A second short subsection records the design convention, so S-02/S-03/S-04 do not re-litigate it: white/slate surfaces with green as a rationed accent; green means primary-action/active/healthy and red means destructive/error; colour comes from the `:root` tokens in `src/styles/global.css` and components use `bg-primary`/`text-primary` rather than hardcoded `green-*`; `green-700` for anything with text in it and `green-600` for rings and borders, because 600 fails AA on white at 3.26:1; and only `:root` is live — the `.dark` block is dead and there is no dark mode.

#### 5. Integration tests — deferred, 2026-08-26

**No test code is written in this phase.** Test authoring was pulled out of this slice by explicit decision and assigned to a dedicated skill that is not yet installed. `tests/integration/specialists.test.ts` is **not** created here.

The existing suites still run as regression gates — running them is not authoring them, they cost seconds against a stack that is already up, and they are what catches a Phase 3 change breaking Phase 1's schema or the existing auth paths.

**What is owed, so the test skill inherits a specification rather than rediscovering one.** The contract below is the one this phase would have implemented, kept verbatim as the hand-off:

Using `createAuthenticatedClient` from the existing helper — create, list, update, delete round trip; blank and whitespace-only input rejected; a second user cannot see or modify the first user's specialists; `updateSpecialist` advances `updated_at` beyond `created_at`; deleting a specialist referenced by a medication fails with the mapped domain error while the row survives; deleting an unreferenced specialist succeeds. Creating the referencing medication needs a `dosage_changes`-free minimal insert — `medications` requires only `specialist_id`, `name`, and `expiry_date`.

Two of these are **higher priority than the round trip**, because they are the only automated proof of rules this phase calls load-bearing:

- **A caller-supplied `updated_at` is ignored.** Call the update path with an object carrying an `updated_at` far in the future alongside a valid `name`; assert the stored value is the module's own timestamp, not the caller's. This is the regression test for the F8 half that the Phase 1 CHECK cannot reach — and, per §2, there is no database-level alternative to fall back on. Until it exists, the application path is enforced by code review and manual step 3.5 alone.
- **A missing or foreign row is not-found, not success.** Assert that updating and deleting a random UUID each produce the not-found outcome rather than reporting success, and that a second user doing the same against the first user's real specialist gets the same not-found result — proving the zero-rows case is being detected rather than swallowed. Note that the pre-existing cross-user isolation test does **not** cover this: it asserts only that the row survives, which stays true when the handler wrongly reports success.

### Success Criteria:

#### Automated Verification:

- Existing integration suite still passes, with no new file added to it: `npm test`
- pgTAP still passes: `npm run db:test`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check` reports 0 errors and 0 warnings

#### Manual Verification:

- Each route exercised against `npm run dev` with a signed-in session cookie, confirming the JSON error contract: a blank name returns 400 with `fieldErrors`, a malformed body returns 400 rather than 500, an unauthenticated call returns 401, a PATCH or DELETE against a random UUID returns 404 rather than 200/204, and deleting a referenced specialist returns 409
- **A PATCH carrying an `updated_at` in its body is ignored**: send one dated far in the future alongside a valid `name`, then read the row back and confirm the stored `updated_at` is the module's own timestamp. This step is load-bearing now rather than confirmatory — with §5 deferred, it is the only check on the F8 half that no database constraint can reach

**Implementation Note**: Pause for manual confirmation before proceeding. Manual verification carries more weight in this phase than the plan originally assumed, because §5's automated coverage was deferred out of the slice.

---

## Phase 4: Specialists UI

### Overview

The screen. List rendered server-side for first paint, handed to a hydrated island that owns all mutations.

### Changes Required:

#### 1. Page

**File**: `src/pages/specialists.astro`

**Intent**: Fetch the list server-side and hand it to the island as initial state, so there is no loading flash and no round trip before first paint.

**Contract**: Frontmatter resolves the Supabase client and calls `listSpecialists`, then renders the island with `client:load` passing the rows as a prop. Uses `Layout.astro` and includes `Topbar.astro` consistently with `dashboard.astro`. If the client is unavailable (`createClient` returns null when unconfigured), render the empty state rather than throwing.

Layout follows the palette established in Phase 2: `bg-background` page, a centred content column capped around `max-w-3xl`, an `h1` in slate-900, and the island in a white `bg-card` panel. Pass a `title` to `Layout` — it currently defaults to `"10x Astro Starter"`, which is starter residue that should not appear in a browser tab on a domain screen.

#### 2. Island

**File**: `src/components/specialists/SpecialistsManager.tsx`

**Intent**: Own the list state and all four interactions.

**Contract**: Takes the SSR'd rows as `initialSpecialists`. Renders the add form, the list, per-row edit and delete controls. Validates with the shared zod schema before sending, and renders `fieldErrors` from a 400 response against the matching fields. Updates local state on success rather than refetching.

The delete control is disabled when the row's usage count is greater than zero, with the reason shown rather than left to a tooltip. A `409` response is still handled — the count is read at page render and a medication can be added in another tab afterwards, so the disable is UX and the 409 path is the actual guarantee.

Deletion is confirmed through the shadcn `alert-dialog` before the request is sent.

Visual contract, following the palette: each specialist is a white `Card` with a slate-200 border, the name in slate-900 and the specialty in slate-600 beneath it. **Add** is the green primary `Button`; **Edit** is `variant="outline"`; **Delete** is `variant="destructive"` (red-600), and its confirm dialog's action button is destructive too — green must never appear on a confirm-delete control, since green is the app's "safe/proceed" signal everywhere else. The disabled-delete reason renders as slate-600 text next to the control, not as a `title` tooltip: tooltips are invisible on touch and to screen readers, and this reason is the user's only explanation for why the control does not work. Row actions stack vertically below the name under `sm:` so the 320 px target is met without truncating the specialty.

#### 3. Route protection

**File**: `src/middleware.ts`

**Intent**: Require a session for the new page.

**Contract**: Add `"/specialists"` to `PROTECTED_ROUTES` (`:4`). The prefix match at `:18` already covers any future sub-paths.

#### 4. Navigation

**File**: `src/components/Topbar.astro`

**Intent**: Make the page reachable.

**Contract**: A `Specialists` link beside the existing `Dashboard` link in the signed-in branch (`:12-15`), matching the restyled link treatment from Phase 2 — green-700 text, **not** the `text-purple-300` those links carry today. If purple is still there when this step is reached, Phase 2 step 4 was left incomplete; fix it there rather than diverging here.

Mark the active route with a green-700 underline or left border plus `aria-current="page"`, so "active" is not conveyed by colour alone. This is the nav pattern S-02/S-03/S-04 extend, so it is worth getting right with two links rather than five.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check` reports 0 errors and 0 warnings
- Build passes: `npm run build`
- Both suites still pass: `npm test` and `npm run db:test`

#### Manual Verification:

- Full round trip in the browser: add a specialist, see it appear, edit it, and delete it
- Delete is disabled with a visible reason for a specialist that has a medication assigned; deleting an unassigned one succeeds
- Inline validation rejects blank and whitespace-only input before any request is sent
- The list is present in the initial HTML response — confirm via view-source, not devtools, that it is server-rendered
- Visiting `/specialists` while signed out redirects to `/auth/signin`
- The whole flow is usable at a 320 px viewport with no horizontal scrolling
- The screen reads as one design with `/dashboard` and the auth screens — white surfaces, green only on Add / links / focus rings, red only on Delete
- Contrast passes AA on `/specialists`: specialty text in slate-600, the green Add button's label, and the disabled-delete reason all ≥ 4.5:1
- The flow is completable by keyboard alone: tab to the add form, submit, reach a row's Edit and Delete, and confirm the alert-dialog — with focus visible at every stop and returned sensibly after the dialog closes

---

## Testing Strategy

### Database tests (`supabase/tests/`, pgTAP)

- The three new `updated_at >= created_at` CHECKs, one assertion per table
- Six new grant assertions (`table_privs_are`): `authenticated` holds all four DML privileges on each of the five domain tables, and `anon` holds none on `specialists`
- Existing 57 assertions serve as the regression net for F4's behaviour-neutral policy rewrite — and, as of the CLI 2.115.0 image bump, for the grants too: their collapse from 57/57 to 14/57 is what surfaced the missing `GRANT` in the first place

### Integration tests (`tests/integration/`, Vitest) — deferred out of this slice, 2026-08-26

**Not written here.** Test authoring was reassigned by explicit decision to a dedicated skill that is not yet installed. The existing suite still runs as a regression gate in Phases 3 and 4; no new file is added to it.

The list below is therefore a **hand-off specification, not a deliverable of this slice** — see Phase 3 §5 for the full contract:

- Full CRUD round trip through the module against PostgREST
- Cross-user isolation: a second authenticated client sees and mutates nothing of the first's
- Blank and whitespace-only input rejected by the database CHECK
- `updated_at` advances on update, and a caller-supplied `updated_at` is ignored
- A missing or foreign `id` yields not-found on both update and delete, rather than silent success
- Delete blocked while referenced; row survives; delete succeeds once unreferenced

The last two are the ones to write first when the skill lands. They are the only automated proof of rules Phase 3 §2 and §3 call load-bearing, and neither has a database-level fallback.

### Manual testing steps

1. Sign up a fresh user and confirm the timezone still reaches `raw_user_meta_data` (Phase 2 regression risk)
2. Add two specialists; confirm both render and persist across a reload
3. Edit one; confirm the change persists
4. Assign a medication to one via Studio, reload, and confirm its delete control is disabled with a reason
5. Delete the unassigned one; confirm it disappears without a reload
6. Sign out and visit `/specialists`; confirm the redirect
7. Repeat the add flow at a 320 px viewport
8. Walk `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/dashboard`, `/specialists` in one pass and confirm a single visual language — no dark background, no purple, green only on primary actions and focus
9. Run an accessibility pass (Lighthouse or axe devtools) on `/auth/signin` and `/specialists`; confirm no contrast violations
10. Repeat step 2 and step 5 using the keyboard only, confirming visible focus throughout and sensible focus return after the delete dialog

### Accepted gap

**Widened on 2026-08-26**, when test authoring was pulled out of the slice. As it now stands, **nothing this slice builds in Phases 3 and 4 carries automated coverage**: not the data module, not the four routes, not the island. The pre-existing pgTAP and integration suites still run, but they assert Phase 1's schema and the auth paths — nothing added after it.

The two specific rules left unguarded are named in Phase 3 §2 and §5: a caller-supplied `updated_at` must be ignored, and a zero-rows match must surface as 404 rather than success. Both are application-path-only by necessity — Phase 1's CHECK cannot reach the first, and RLS's zero-rows semantics are what create the second — so deferring their tests removes the only mechanism that would catch a regression.

That is a deliberate, recorded trade rather than an oversight, and the manual criteria in Phases 3 and 4 were strengthened to compensate as far as manual checks can. It is not equivalent cover: a manual step confirms the behaviour once, on the day, and cannot fail a future change.

The island's validation and delete-disable branches were already uncovered before this decision — installing a component-test harness was considered and excluded during planning. Manual steps 2, 4 and 7 are the only checks on that logic.

Visual and accessibility conformance is likewise manual only. No visual-regression tooling and no automated axe run in CI is in scope here; the `grep` in Phase 2 is the one mechanical check, and it can only prove the old theme is gone, not that the new one is right. If the palette starts drifting across S-02/S-03/S-04, that is the signal to add real tooling — not a reason to add it now for one screen.

## Performance Considerations

The list is server-rendered, so first paint costs one query and no client round trip — the strongest available answer to the NFR's sub-1s dashboard target. Usage counts add at most two lightweight reads. F4's index and policy work in Phase 1 matters more for S-04's dashboard than for this screen, but lands here because the policy set is still small enough to rewrite in one pass.

## Migration Notes

Phase 1's migration is additive and behaviour-neutral, and no rows exist in any environment, so nothing can be rejected retroactively. It stays **local** — pushing to cloud is a deliberate manual step outside this plan, consistent with F-01's decision and `infrastructure.md:91` (a Worker rollback does not roll back the database).

The grants are the one part that is environment-sensitive rather than environment-neutral. Locally they **restore** access that a newer Postgres image withdrew. On cloud they are expected to be a no-op, because that project was created under the old permissive default and already holds the same privileges — `GRANT` is idempotent, so re-granting an existing privilege changes nothing. That expectation is unverified; check `information_schema.role_table_grants` on cloud before the push rather than assuming it, and treat a surprise there as a reason to stop rather than proceed.

Rollback within a phase is `npm run db:reset`. Once pushed, the `updated_at` CHECK would need a `drop constraint` migration to reverse; the F4 rewrite reverses by re-running `alter policy` with the unwrapped expression; the grants reverse with the matching `revoke`, though doing so on cloud would break the running app, which is the point of them.

## References

- Roadmap item: `context/foundation/roadmap.md` → S-01
- Schema this builds on: `supabase/migrations/20260813185255_domain_schema.sql`
- Deferred decisions inherited: `context/changes/domain-schema-foundation/reviews/impl-review.md` → F4, F8
- Still-queued sibling: `context/changes/domain-schema-foundation/follow-ups/review-fixes.md` → F3
- Form pattern reference: `src/components/auth/SignUpForm.tsx`, `src/pages/auth/signup.astro`
- Test helper: `tests/integration/helpers/client.ts:41`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema — `updated_at` guard and F4 policy rewrite

#### Automated

- [x] 1.1 Migration applies from scratch: `npm run db:reset` — fd0ffe5
- [x] 1.2 pgTAP passes at 70 assertions (57 + 3 CHECK + 10 grants): `npm run db:test` — fd0ffe5
- [x] 1.3 Grants survive a from-scratch reset: `npm run db:reset` then `npm run db:test` green with no manual GRANT in between — fd0ffe5
- [x] 1.4 Generated types are unchanged: `npm run db:types` leaves no diff — fd0ffe5
- [x] 1.5 Linting passes: `npm run lint` — fd0ffe5

#### Manual

- [x] 1.6 Studio rejects an UPDATE setting `updated_at` before `created_at` on each of the three tables — 0adb76e
- [x] 1.7 `authenticated` holds all four DML privileges on all five tables and `anon` holds none, after a clean reset — 0adb76e
- [x] 1.8 The same grant query against the cloud project — checked 2026-08-25: `authenticated` complete on all five tables, `anon` also granted (legacy platform default, RLS holding), resolved by adding an explicit `revoke`. Result recorded in `change.md` — 0adb76e
- [x] 1.9 `npx supabase migration list` shows the new migration as local-only — 0adb76e

### Phase 2: Design system — primitives and auth restyle

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 07adbf0
- [x] 2.2 Type checking passes: `npx astro check` reports 0 errors and 0 warnings — 07adbf0
- [x] 2.3 Build passes: `npm run build` — 07adbf0
- [x] 2.4 No dark-theme remnants: the PowerShell `Select-String` scan from Phase 2 step 4 returns no output — 07adbf0

#### Manual

- [x] 2.5 Sign-in and sign-up render correctly and both still submit successfully — 47b97db
- [x] 2.6 A real signup still stores the browser timezone in `raw_user_meta_data` — 47b97db
- [x] 2.7 Server-side error display still works on a duplicate-email submit — 47b97db
- [x] 2.8 Both auth screens usable at 320 px with no horizontal scrolling — 47b97db
- [x] 2.9 Every existing screen renders white/slate with green only on primary actions, links, and focus rings — 47b97db
- [x] 2.10 Contrast passes AA on the auth screens and dashboard (text ≥ 4.5:1, UI ≥ 3:1) — 47b97db
- [x] 2.11 Keyboard focus is visible on every interactive element — 47b97db
- [x] 2.12 Replaced landing page at `/` renders, its sign-in/sign-up buttons work, and the tab title is no longer "10x Astro Starter" — 47b97db

### Phase 3: Data layer — validation, module, JSON routes, tests

#### Automated

- [x] 3.1 Existing integration suite still passes, with no new file added to it: `npm test` — 36b2500
- [x] 3.2 pgTAP still passes: `npm run db:test` — 36b2500
- [x] 3.3 Linting passes: `npm run lint` — 36b2500
- [x] 3.4 Type checking passes: `npx astro check` reports 0 errors and 0 warnings — 36b2500

#### Manual

- [x] 3.5 Routes exercised against `npm run dev` confirming the JSON error contract for 400 (blank), 400 (malformed body), 401, 404 (random UUID), and 409 — 36b2500
- [x] 3.6 A PATCH carrying an `updated_at` in its body is ignored — the stored value is the module's own timestamp — 36b2500

### Phase 4: Specialists UI

#### Automated

- [x] 4.1 Linting passes: `npm run lint`
- [x] 4.2 Type checking passes: `npx astro check` reports 0 errors and 0 warnings
- [x] 4.3 Build passes: `npm run build`
- [x] 4.4 Both suites still pass: `npm test` and `npm run db:test`

#### Manual

- [x] 4.5 Full round trip in the browser: add, edit, delete
- [x] 4.6 Delete disabled with a visible reason when a medication is assigned; unassigned delete succeeds
- [x] 4.7 Inline validation rejects blank and whitespace-only input before any request
- [x] 4.8 List is present in the initial HTML response (view-source, not devtools)
- [x] 4.9 Signed-out visit to `/specialists` redirects to `/auth/signin`
- [x] 4.10 Whole flow usable at 320 px with no horizontal scrolling
- [x] 4.11 `/specialists` reads as one design with `/dashboard` and the auth screens
- [x] 4.12 Contrast passes AA on `/specialists` (specialty text, Add button label, disabled-delete reason)
- [x] 4.13 Full flow completable by keyboard alone, with visible focus and sensible focus return after the delete dialog
