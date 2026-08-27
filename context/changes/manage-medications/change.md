---
change_id: manage-medications
title: Manage medications — add, edit, archive, and restore a medication with a single current daily dosage
status: plan_reviewed
created: 2026-08-27
updated: 2026-08-27
archived_at: null
---

## Notes

from @context/foundation/roadmap.md

Roadmap item **S-02** (slice, prerequisites `F-01`, `S-01`) — GitHub [#3](https://github.com/monika-mur/medcalc/issues/3) plus sub-issues #13–#15.

- **Outcome:** user can add a medication (name, quantity on hand, expiry date, daily dosage, assigned specialist), edit it, or archive it (soft delete).
- **PRD refs:** FR-004, FR-005, FR-007.
- **Unlocks:** S-04 (dashboard) needs medications to calculate against; S-05 (mid-supply dosage change) and S-06 (liquid) both extend this slice.
- **Parallel with:** S-03 (`manage-doctor-visits`), running in a sibling worktree. Both share one local Supabase stack — see `lessons.md` → _Reset the database from your own worktree before you use it_.

### Why this slice is harder than "core entity CRUD" suggests

The roadmap calls S-02 "core entity CRUD" and the plumbing genuinely is a copy of S-01's — same `Result<T>` data module, same JSON error contract, same SSR-then-hydrate island. The domain underneath is not, for three reasons that F-01 designed in deliberately:

1. **A medication is three rows in three tables, and PostgREST has no transaction.** `medications` carries no `daily_dosage` and no `quantity_on_hand` column by design (`20260813185255_domain_schema.sql:52-56`); dosage lives only in `dosage_changes` and quantity only in `supply_events` deltas. Creating one medication is three separate calls, and the no-trigger / no-RPC property forbids wrapping them.

2. **"Edit dosage" and "edit quantity" are not UPDATEs.** `dosage_changes` has no UPDATE policy at all and `supply_events` has neither UPDATE nor DELETE. Corrections are new rows, or — for a dosage set earlier the same day — a delete-then-insert that the original DELETE policy did not permit.

3. **Three later slices meet inside this one.** S-04 owns the calculation and the current-state views, S-05 owns future-dated dosage changes, S-06 owns liquid. All three touch columns and rows S-02 must write today.

### Decisions taken at planning (2026-08-27)

| Question                        | Answer                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Non-atomic three-insert create  | Ordered inserts; dosage 0 and quantity 0 are **legitimate domain states**, not failure debris       |
| Same-day dosage correction      | Relax the DELETE policy to `effective_date >= current_date` — immutable once *past*, not once *set* |
| Quantity editing                | `refill` for additions, `adjustment` for corrections; no `recount` until S-04 can project           |
| Current-state read path         | Aggregate in TypeScript now; S-04 replaces it with views                                            |
| Liquid sub-type                 | Solid only — rejected in zod as well as absent from the form                                        |
| Archival                        | Archive **and** restore, behind a "Show archived" toggle                                            |
| Tests                           | **None in this slice.** A dedicated test slice is planned — see `follow-ups/deferred-tests.md`      |
| S-01's open follow-ups          | Not absorbed; both queues stay open                                                                 |

The developer's framing of the first row is the load-bearing one and is quoted in the plan: a user who stops taking a medication should still see it listed, so `daily_dosage = 0` is a proper state; a user who has finished a pack and has no new one is at `quantity = 0`, also proper. The UI therefore labels these rather than warning about them.

### Coordination with the parallel S-03 session

This slice ships **one migration** (Phase 1). `supabase/config.toml` pins `project_id` and fixed ports, so `supabase db reset` from this worktree re-applies *this* branch's migrations only and removes S-03's. Phase 1's verification steps therefore claim the stack explicitly and hold the claim until they finish. No `npm run db:types` run is needed anywhere in this slice — a policy change alters no types — which removes the worst failure mode in that lesson.
