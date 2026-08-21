# Manage Specialists (S-01) — Plan Brief

> Full plan: `context/changes/manage-specialists/plan.md`

## What & Why

Ship the first user-facing domain slice: a `/specialists` screen where the user adds a specialist (name, specialty), sees their list, edits an entry, and deletes one that has nothing assigned. FR-003 makes this a managed entity rather than a free-text field because "inconsistent spelling of specialist names breaks the core calculation" — S-02 and S-03 both need a specialist to point at.

## Starting Point

The `specialists` table already exists from F-01, with non-blank CHECKs and all four RLS policies granted — it is the only table in the schema with full CRUD. Nothing consumes it: `src/pages/api/` holds only the three auth routes, `dashboard.astro` is a placeholder, and there is no `src/lib/db/`. shadcn is configured but `src/components/ui/` holds only `button.tsx`; the auth screens use a hand-rolled `FormField` with glassmorphism styling.

## Desired End State

A signed-in user opens `/specialists`, sees their list on first paint with no loading flash, and can add, edit, or delete inline. Delete is disabled with a visible reason when medications or visits still reference the specialist. The flow works at 320 px without horizontal scrolling, and signed-out visitors are redirected to sign-in.

The app also carries one visual system by the end of the slice: white/slate surfaces with green as a rationed accent, driven by `:root` design tokens, at AA contrast. Every pre-existing screen moves off the dark glassmorphism theme in Phase 2.

## Key Decisions Made

| Decision          | Choice                              | Why (1 sentence)                                                                                                 |
| ----------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Scope             | Full CRUD, delete guarded           | RLS already grants all four commands; delete is blocked while medications or visits reference the row            |
| Data access       | `src/lib/db/specialists.ts`         | This slice has two call sites already (page + routes), which is the consumer F-01 said to wait for               |
| API style         | Client `fetch` + JSON               | Chosen over the auth routes' redirect pattern; the split rule gets documented so S-02 follows it deliberately    |
| List rendering    | SSR then hydrate                    | No loading flash and no round trip before first paint — the strongest answer to the sub-1s mobile NFR            |
| Validation        | zod, shared client + server         | The DB CHECKs must be mirrored in two places, and S-02's numeric/date/liquid rules make hand-rolling error-prone |
| Delete guard      | Disable in UI **and** catch `23503` | The count is racy across tabs, so the FK is the real guarantee and the disable is UX                             |
| `updated_at`      | Module writes it + `CHECK`          | Settles the decision F-01 deferred to S-01; the CHECK is what makes an application convention enforceable        |
| Review follow-ups | Fold in F4 only                     | Behaviour-neutral, and it rides along in a migration this slice already ships; F3 stays queued                   |
| UI primitives     | shadcn + app-wide restyle           | User's call — one visual system rather than two; `FormField` changes by swapping internals, not its callers      |
| Design direction  | White/slate + green accent, tokens  | Clinical and calm for a medical tool; green-700 for text (green-600 fails AA on white at 3.26:1), 600 for rings  |
| Testing           | Integration + pgTAP                 | Follows `CLAUDE.md`'s own split rule; no component-test harness in this slice                                    |

## Scope

**In scope:** explicit table GRANTs, the `updated_at` CHECK, and F4's policy/index migration; `zod` and shadcn primitives; the design tokens and an **app-wide restyle** off the dark theme — auth screens, confirm-email, dashboard (visually), plus replacing the starter landing and deleting `ui/LibBadge.astro`; the validation schema, data module, and four JSON routes; the `/specialists` page and island; route protection and navigation; integration and pgTAP coverage.

**Out of scope:** medications, visits, and dashboard _functionality_ (the dashboard is repainted, not built); specialist detail pages; search/sort/filter/pagination; name uniqueness; soft delete for specialists; F3 account erasure; a component-test harness; dark mode; visual-regression or automated a11y tooling; CI changes; pushing the migration to cloud.

## Architecture / Approach

`specialists.astro` resolves the Supabase client in frontmatter and calls `listSpecialists`, passing rows to a `client:load` island as initial state. The island owns all mutations, sending JSON to `/api/specialists` and `/api/specialists/[id]`, which validate with the shared zod schema and delegate to the same data module. RLS is the only owner-filter anywhere in the stack — no query filters by `user_id`, so a policy regression fails a test rather than hiding behind redundant application code.

## Phases at a Glance

| Phase            | What it delivers                                                                                 | Key risk                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Schema        | Explicit GRANTs on all five tables + `updated_at` CHECK on three + F4 policy rewrite and indexes | Migrating a schema already live in cloud — though no rows exist anywhere yet; the grants are expected to be a cloud no-op but that is unverified |
| 2. Design system | `zod`, shadcn primitives, tokens, app-wide restyle off the dark theme                            | Restyling working auth forms with no component tests, edited hours ago for F10                                                                   |
| 3. Data layer    | Validation schema, data module, four JSON routes, integration tests                              | A second API convention alongside the auth routes' redirect pattern                                                                              |
| 4. UI            | `/specialists` page, island, nav, route protection                                               | List state living in both server props and client state                                                                                          |

**Prerequisites:** F-01 complete (it is — migration applied to cloud 2026-08-18). Docker Desktop and the local Supabase stack running; `.env`/`.dev.vars` pointed at the local stack, which the integration suite requires.

**Estimated effort:** ~4–5 sessions. Phases 1 and 3 are the substantive ones; 2 is mechanical but wide — it touches ten working files with no automated coverage behind them — and 4 is the visible payoff.

## Open Risks & Assumptions

- **PostgREST may not resolve the usage-count embed** across the composite FK `(specialist_id, user_id)`. The plan names a tally-in-TypeScript fallback, which is free at this data volume.
- **The signup timezone capture is the likeliest Phase 2 regression** — it depends on an uncontrolled hidden input surviving a re-render, and is verified only manually.
- **The island's validation and delete-disable branches ship untested by machine.** Accepted deliberately; three manual steps are the only coverage.
- **F4's rewrite touches all five tables** when only `specialists` is exercised here; the existing 57 pgTAP assertions and 15 integration tests are the regression net.
- **Two API conventions will coexist permanently.** The plan documents the rule that decides between them; if that rule is not written down, S-02 will copy whichever route it reads first.
- **The schema never issued GRANTs and silently relied on a platform default that has since changed.** Discovered 2026-08-21 when a Supabase CLI bump pulled a Postgres image with a restricted default ACL, taking pgTAP from 57/57 to 14/57. Phase 1 now issues them explicitly. **Cloud is expected to be unaffected and that is unverified** — check `role_table_grants` there before the next push.

## Success Criteria (Summary)

- A user can add, view, edit, and delete their specialists, and cannot delete one still in use
- S-02 and S-03 are unblocked: a specialist exists to assign medications and visits to
- The patterns for data access, validation, API errors, and list rendering are established and documented for the three slices that follow
