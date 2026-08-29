# Manage Medications (S-02) — Plan Brief

> Full plan: `context/changes/manage-medications/plan.md`

## What & Why

Ship `/medications`: add a medication (name, specialist, expiry date, starting daily dosage, starting quantity), edit it, change the dosage, record refills and count corrections, and archive or restore it. FR-004, FR-005, FR-007. S-04's dashboard cannot exist without medications to calculate against, and S-05 and S-06 both extend this slice.

## Starting Point

F-01 shipped the whole schema — nothing here creates a table. `medications`, `dosage_changes`, and `supply_events` exist with their CHECKs, composite FKs, RLS policies and explicit `GRANT`s, applied to both local and cloud. S-01 established every pattern this slice copies: the `Result<T>` data module with `logDbError`, the `{ error: { message, fieldErrors? } }` JSON contract, shared zod schemas, and the SSR-then-hydrate island. The design system, shadcn primitives, and `:root` token palette are done. What is missing is any medications route, page, component, schema, or data module.

## Desired End State

A signed-in user sees every medication they track, each with its current dosage, quantity on hand, expiry date, specialist, and a derived status label. They can add, edit details, change the dosage (including setting it to `0` to record "I stopped taking this"), refill, correct the recorded amount, and archive or restore. Archived rows sit behind a toggle. The screen works at 320 px, and a user with no specialists yet is sent to `/specialists` first, because `specialist_id` is `not null`.

## Key Decisions Made

| Decision                  | Choice                                              | Why (1 sentence)                                                                                              |
| ------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Non-atomic create         | Ordered inserts; `0` states are legitimate          | The developer's framing: stopping a medication and running out are proper states, not failure debris             |
| Same-day dosage fix       | Relax DELETE to `effective_date >= current_date`    | A typo'd dosage was otherwise uncorrectable for 24 hours, and no existing test asserts behaviour at today's date |
| Quantity editing          | `refill` for additions, `adjustment` for corrections | A true `recount` needs `projected_quantity` from S-04's consumption engine, which does not exist yet             |
| Current-state read        | Aggregate in TypeScript, stable signature           | Avoids a migration (and a shared-stack claim) while leaving S-04's views a drop-in body swap                     |
| Liquid sub-type           | Solid only, **rejected** in zod not just omitted     | S-06 owns liquid; an API caller must not be able to create a row this slice cannot display                       |
| Archival                  | Archive **and** restore, behind a toggle            | There is no DELETE policy, so without restore a mis-click is unrecoverable without raw SQL                       |
| Mutation surface → table  | Sub-resource routes for dosage, supply, archive     | Keeps every zod schema a flat object, so `zodFieldErrors` maps one-to-one onto form fields                       |
| Tests                     | **None in this slice**                              | Developer's call; a dedicated test slice follows, spec'd in `follow-ups/deferred-tests.md`                       |
| S-01's open follow-ups    | Not absorbed                                         | Keeps S-02 reviewable against its own plan and avoids re-walking S-01's untested auth screens                    |

## Scope

**In scope:** one policy-relaxation migration; `src/lib/validation/medication.ts` (four schemas); `src/lib/db/medications.ts` (list, create, update details, set dosage, record supply, set archived); five API route files; `medications.astro` and the `MedicationsManager` island; `PROTECTED_ROUTES` and Topbar nav; two new rules in `CLAUDE.md`.

**Out of scope:** the supply-end calculation, colour status, and dashboard (S-04); future-dated dosage changes (S-05); liquid medications (S-06); `recount` events; current-state SQL views; every automated test; S-01's and F-01's queued follow-ups; search / sort / filter / pagination / detail pages; pushing the migration to cloud.

## Architecture / Approach

`medications.astro` resolves the Supabase client in frontmatter, calls `listMedications` and `listSpecialists`, and hands both to a `client:load` island as initial state. The island owns every mutation over `fetch`. **Every mutation surface maps to the table it writes**: `PATCH /api/medications/[id]` for the medication's own columns, `POST …/dosage` for `dosage_changes`, `POST …/supply` for `supply_events`, `POST …/archive` for `archived_at`. Routes are thin adapters — authenticate, guard the body, parse with the shared schema, delegate exactly one call. All multi-statement sequencing lives in the data module. RLS is the only owner filter anywhere in the stack.

## Phases at a Glance

| Phase                  | What it delivers                                                        | Key risk                                                                                             |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1. Migration           | `dosage_changes` DELETE relaxed to `>= current_date`, policy renamed     | Narrows an F-01 invariant that S-05 also relies on; needs an exclusive claim on the shared local stack |
| 2. Validation + module | Four zod schemas and the whole data module, including the three-insert create | The non-atomic create and the DELETE-then-INSERT dosage replace, both shipping without machine coverage |
| 3. API routes          | Five route files answering the established JSON contract                | Five surfaces where a raw body could reach the module or a Postgres message could reach a response      |
| 4. Page + island       | `/medications`, status badges, archive toggle, nav, `CLAUDE.md` rules   | The largest island in the app so far, with no component-test harness behind it                        |

**Prerequisites:** F-01 and S-01 complete (both are). Docker Desktop and the local Supabase stack running, `.env` / `.dev.vars` pointed at it. Coordination with the parallel S-03 worktree, which shares that one stack.

**Estimated effort:** ~3–4 sessions. Phase 2 is the substantive one; Phase 1 is a single statement with disproportionate verification cost; Phase 4 is wide but mechanical.

## Open Risks & Assumptions

- **The three-insert create ships untested, and its failure mode is invisible by design.** A partial result looks exactly like a legitimate "stopped" or "out of stock" medication, so manual walking cannot distinguish them. This is the single largest accepted risk in the slice.
- **The same-day dosage replace is a DELETE-then-INSERT, made reversible by a compensating write** (plan review, 2026-08-27). The DELETE returns the value it removes and the module re-inserts it if the replacement INSERT fails. Without that, a failed correction would silently delete the user's previous dosage and the row would render as a deliberate *Not used*. The compensating INSERT can itself fail; that is the residual exposure and it logs distinctly.
- **`.upsert()` is unusable on `dosage_changes` and `supply_events`** — PostgREST compiles it to `ON CONFLICT DO UPDATE` and neither table has an UPDATE policy. An implementer reaching for it will get a confusing RLS failure; Phase 4 writes the rule into `CLAUDE.md`.
- **Dates must be computed in UTC on the server.** The DELETE policy compares against Postgres `current_date`; a browser-derived date disagrees with it for part of every day, and the symptom appears only near midnight.
- **The correction path reads before it writes**, so two tabs correcting at once race with the later write winning on a stale base. Accepted at single-user volume; S-04's `recount` is the structural fix.
- **`listMedications` pulls every dosage and supply row to compute two numbers.** Fine at 20 medications, wrong at two years of daily events. The signature is kept stable so S-04's views replace only the body.
- **The shared local stack.** `db:reset` from this worktree removes the S-03 worktree's schema, not just its rows. Mitigated by claiming the stack for database steps only, and by this slice running `db:types` nowhere.
- **Phase 1 narrows an F-01 invariant** from "immutable once effective" to "immutable once past". S-05 depends on the untouched `> current_date` half for future-dated rows.

## Success Criteria (Summary)

- A user can add, edit, re-dose, refill, correct, archive, and restore a medication, and correcting a dosage typed wrong minutes ago works
- Stopping a medication (`dosage 0`) and running out (`quantity 0`) both read as labelled states, with the row still visible — not as errors or warnings
- S-04 is unblocked: medications with a derivable current dosage and quantity exist to calculate against
