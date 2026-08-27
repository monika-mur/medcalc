---
project: MedCalc
version: 1
status: draft
created: 2026-07-04
updated: 2026-08-27
prd_version: 1
main_goal: speed
top_blocker: capacity
---

# Roadmap: MedCalc

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Individuals managing multiple chronic medications can't reliably tell whether their current supply will last until their next doctor visit — the calculation gets especially error-prone when a dosage changes mid-supply, a case existing medication-reminder apps don't handle. MedCalc treats this supply-versus-next-visit calculation as the primary domain problem, not a downstream reminder feature.

## North star

**S-05: User can schedule a future dosage change and see the dashboard recalculate the supply-end date and status accordingly** — chosen as the validation milestone because it is the hardest, most differentiating case the Vision calls out (existing apps get mid-supply dosage changes wrong); proving this works validates the app's core reason to exist.

> The north star is the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — placed as early as its Prerequisites allow, because everything else only matters if this works. This gloss applies the first time "north star" appears in this document; it is not repeated below.

## At a glance

| ID   | Change ID                  | Outcome (user can …)                                                                       | Prerequisites | PRD refs                                 | Status   | GitHub                                               |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------ | ------------- | ---------------------------------------- | -------- | ---------------------------------------------------- |
| F-01 | domain-schema-foundation   | (foundation) domain schema exists: specialists, medications, dosage-change history, visits | —             | Business Logic (historical preservation) | done     | [#1](https://github.com/monika-mur/medcalc/issues/1) |
| S-01 | manage-specialists         | add, view, and manage the specialists they see                                             | F-01          | FR-003                                   | done     | [#2](https://github.com/monika-mur/medcalc/issues/2) |
| S-02 | manage-medications         | add, edit, and archive a medication with a single current daily dosage                     | F-01, S-01    | FR-004, FR-005, FR-007                   | proposed | [#3](https://github.com/monika-mur/medcalc/issues/3) |
| S-03 | manage-doctor-visits       | add, edit, and delete a doctor visit                                                       | F-01, S-01    | FR-009, FR-010                           | planning | [#4](https://github.com/monika-mur/medcalc/issues/4) |
| S-04 | supply-status-dashboard    | see, per medication, the calculated supply-end date and color status vs. next visit        | S-02, S-03    | FR-011, US-01                            | proposed | [#5](https://github.com/monika-mur/medcalc/issues/5) |
| S-05 | mid-supply-dosage-change   | schedule a future dosage change and see the recalculated status                            | S-02, S-04    | FR-006, US-02                            | proposed | [#6](https://github.com/monika-mur/medcalc/issues/6) |
| S-06 | liquid-medication-tracking | track a liquid medication's supply using container capacity and post-opening expiry        | S-02, S-04    | FR-008                                   | proposed | [#7](https://github.com/monika-mur/medcalc/issues/7) |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                   | Chain                                      | Note                                                                                |
| ------ | ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| A      | Core domain & dashboard | `F-01` → `S-01` → `S-02` → `S-04` → `S-05` | Main line to the north star; speed-biased — no detours before S-05.                 |
| B      | Visit tracking          | `S-03`                                     | Joins Stream A at `S-04` (dashboard needs both medications and visits).             |
| C      | Liquid medications      | `S-06`                                     | Joins Stream A at `S-04`; parallel with `S-05`, lower priority than the north star. |

## Baseline

What's already in place in the codebase as of `2026-07-04` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + TypeScript, shadcn/ui (`new-york` style, `@components.json`), per `tech-stack.md`.
- **Backend / API:** partial — SSR active (`astro.config.mjs`, `@astrojs/cloudflare` adapter); only auth-scoped API routes exist (`src/pages/api/auth/{signin,signup,signout}.ts`). No domain-entity endpoints (specialists, medications, visits) exist yet.
- **Data:** partial — Supabase client wired (`src/lib/supabase.ts:4-25`); no migrations (`supabase/migrations/` absent) and no domain schema/types for specialists, medications, dosage changes, or visits.
- **Auth:** present — Supabase Auth fully implemented: session verification in `src/middleware.ts:12`, sign-in/sign-up/sign-out routes, `PROTECTED_ROUTES = ["/dashboard"]`, working `SignInForm`/`SignUpForm` components, dev/prod-aware email confirmation flow. **FR-001 and FR-002 (register, log in/out) are already fully satisfied by this baseline and are intentionally not represented as a roadmap slice.**
- **Deploy / infra:** present — Cloudflare Workers configured (`wrangler.jsonc`, `name: "medcalc"`, `env.preview`), production secrets set, CI (`.github/workflows/ci.yml`) deploys on push to `master`, preview deploy on PRs.
- **Observability:** partial — `wrangler.jsonc` has `observability.enabled: true` (Workers Logs); no application-level structured logging or error tracking exists. Not treated as a Foundation — no PRD NFR or must-have FR requires it for MVP, consistent with the `speed` goal.

## Foundations

### F-01: Domain schema for specialists, medications, dosage-change history, and visits

- **Outcome:** (foundation) The database schema and migrations for `specialists`, `medications` (including liquid-medication fields), `dosage_changes` (history), and `visits` exist, designed so that every state change is append-only and reconstructible from day one.
- **Change ID:** domain-schema-foundation
- **PRD refs:** Business Logic — "Historical data preservation (binding architectural constraint)"; underlies FR-003, FR-004, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011.
- **Unlocks:** S-01, S-02, S-03, S-04, S-05, S-06 — every domain-facing slice reads or writes this schema; none can be planned or verified without it.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The Business Logic section requires medication state changes (dosage adjustments, quantity updates, archival) to be recorded as immutable, timestamped records reconstructible at any point in time — not overwritten. Designing this once, correctly, avoids a retrofit after slices have already started writing data in a simpler (mutable) shape, which would directly threaten the PRD's "calculation accuracy" guardrail.
- **Status:** done

## Slices

### S-01: Manage specialists

- **Outcome:** user can add a specialist (name, specialty) and see the list of specialists they track.
- **Change ID:** manage-specialists
- **PRD refs:** FR-003
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Small and low-risk; sequenced first among slices because both medications (S-02) and visits (S-03) require an existing specialist to assign to.
- **Status:** done

### S-02: Manage medications (single current dosage)

- **Outcome:** user can add a medication (name, quantity on hand, expiry date, daily dosage, assigned specialist), edit it, or archive it (soft delete).
- **Change ID:** manage-medications
- **PRD refs:** FR-004, FR-005, FR-007
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Core entity CRUD. Dosage is entered as a single daily total per FR-005 (split-dose entry is deferred to v2), which keeps the form simple and matches the speed-oriented sequencing bias.
- **Status:** proposed

### S-03: Manage doctor visits

- **Outcome:** user can add a doctor visit (date, specialist), and edit or delete it.
- **Change ID:** manage-doctor-visits
- **PRD refs:** FR-009, FR-010
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Straightforward CRUD. The "no visit scheduled" display state (FR-009) is rendered in S-04, not here — this slice stays focused on visit data entry only.
- **Status:** planning

### S-04: Supply-status dashboard

- **Outcome:** user sees, for each medication, the calculated supply-end date and a color-coded status (green/yellow/red, or "no visit scheduled") relative to the next visit with the assigned specialist.
- **Change ID:** supply-status-dashboard
- **PRD refs:** FR-011, US-01
- **Prerequisites:** S-02, S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the PRD's Primary Success Criterion — the first point where the user gets real end-to-end value. It depends on both entity slices because the dashboard joins medications, visits, and specialists to compute status.
- **Status:** proposed

### S-05: Mid-supply dosage change

- **Outcome:** user can schedule a future dosage change (new daily amount, effective date) for a medication, and the dashboard immediately recalculates the supply-end date and status using the segmental (old-dose-then-new-dose) calculation.
- **Change ID:** mid-supply-dosage-change
- **PRD refs:** FR-006, US-02
- **Prerequisites:** S-02, S-04
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Chosen north star — the hardest, most differentiating case per the Vision (mid-supply dosage changes are what existing apps get wrong). It cannot land before S-04 exists, since it needs the calculation engine and status display to show the recalculated result — but it is prioritized immediately after S-04, ahead of S-06, given the `speed` goal and its role as the validation milestone.
- **Status:** proposed

### S-06: Liquid medication tracking

- **Outcome:** user can mark a medication as liquid and enter container capacity, estimated daily consumption, and post-opening expiry duration; the dashboard shows the correct supply-end date (the earlier of calculated consumption date and post-opening expiry).
- **Change ID:** liquid-medication-tracking
- **PRD refs:** FR-008
- **Prerequisites:** S-02, S-04
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Extends the calculation for a medication sub-type. Parallel with S-05 since neither blocks the other, but secondary in priority to S-05, which is the chosen north star.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                  | Suggested issue title                                                                       | Ready for `/10x-plan` | Notes                                             | GitHub                                                                    |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| F-01       | domain-schema-foundation   | Design domain schema: specialists, medications, dosage-change history, visits (append-only) | shipped               | Done — see `## Done`                              | [#1](https://github.com/monika-mur/medcalc/issues/1) + #8–#12 sub-issues  |
| S-01       | manage-specialists         | Add and manage specialists                                                                  | shipped               | Done — see `## Done`                              | [#2](https://github.com/monika-mur/medcalc/issues/2)                      |
| S-02       | manage-medications         | Add and manage medications (single current dosage)                                          | yes                   | Unblocked — parallel with S-03                    | [#3](https://github.com/monika-mur/medcalc/issues/3) + #13–#15 sub-issues |
| S-03       | manage-doctor-visits       | Add and manage doctor visits                                                                | yes                   | Unblocked — parallel with S-02                    | [#4](https://github.com/monika-mur/medcalc/issues/4) + #16–#17 sub-issues |
| S-04       | supply-status-dashboard    | Build the supply-status dashboard                                                           | no                    | Blocked until S-02, S-03 land                     | [#5](https://github.com/monika-mur/medcalc/issues/5)                      |
| S-05       | mid-supply-dosage-change   | Support mid-supply dosage changes (north star)                                              | no                    | Blocked until S-02, S-04 land                     | [#6](https://github.com/monika-mur/medcalc/issues/6)                      |
| S-06       | liquid-medication-tracking | Track liquid medications                                                                    | no                    | Blocked until S-02, S-04 land; parallel with S-05 | [#7](https://github.com/monika-mur/medcalc/issues/7)                      |

This table is the clean handoff to Jira/Linear or any MCP-backed backlog.

**Handed off on 2026-08-02 to GitHub Issues** — <https://github.com/monika-mur/medcalc/issues>. 24 issues: 7 parents above (milestone `MVP v1`) + 10 sub-issues + [#18](https://github.com/monika-mur/medcalc/issues/18) (the Open Roadmap Question below) + [#19](https://github.com/monika-mur/medcalc/issues/19)–[#24](https://github.com/monika-mur/medcalc/issues/24) (the Parked section below, milestone `v2 (parked)`). Prerequisites are wired as native GitHub `blocked by` dependencies; `Status` values in this document remain the roadmap's own and are not synced from issue state.

## Open Roadmap Questions

1. **Competitive landscape:** Are equivalent medication supply calculators already available? If so, what does MedCalc do differently or better? — Owner: user. Block: soft — does not block MVP development (roadmap-wide), but affects positioning and scope-validation decisions before launch.

## Parked

- **Treatment history browsing UI:** Data is recorded from day one (see F-01), but no history browsing screen ships in v1. Why parked: PRD §Non-Goals — core value is the supply calculator; history display is a v2 feature once data has accumulated.
- **Push or email notifications:** Low-supply and approaching-expiry alerts are deferred. Why parked: PRD §Non-Goals — background-job infrastructure before the core calculation is validated adds disproportionate complexity for a `speed`-first MVP.
- **Integration with e-prescription or pharmacy systems:** All data stays manually entered. Why parked: PRD §Non-Goals — no external health IT integration planned for v1.
- **Managing medications for other people:** One account covers one user's own medications. Why parked: PRD §Non-Goals — multi-patient/caregiver delegation out of scope for v1.
- **Split dosage entry mode (N units × M times/day):** v1 accepts a single daily total only (FR-005). Why parked: PRD §Non-Goals — v2 feature; users convert manually for now.
- **Configurable color-status thresholds:** Green/yellow/red thresholds are hardcoded in v1 (see S-04, F-01). Why parked: PRD §Non-Goals — configurable thresholds are v2.

## Done

Completed items, newest first. A slice lands here when its change is implemented, reviewed, and merged — not when its code is written.

| ID   | Change ID                | Outcome delivered                                                              | Completed  | Evidence                                                                                                                            |
| ---- | ------------------------ | ------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | manage-specialists       | Add, list, edit, and delete specialists; delete blocked while referenced       | 2026-08-27 | [#2](https://github.com/monika-mur/medcalc/issues/2) · [PR #26](https://github.com/monika-mur/medcalc/pull/26) · live in production |
| F-01 | domain-schema-foundation | Append-only domain schema for specialists, medications, dosage changes, visits | 2026-08-27 | [#1](https://github.com/monika-mur/medcalc/issues/1) · migrations `20260813185255`, `20260821182457` — both applied to cloud        |

**Carried forward, not closed by these:** F-01's follow-ups (F2 numeric scale, F3 GDPR erasure, F9 CI gating, D-01 mirrored grants, the partial-index remark) and S-01's (`specialists-tests`, `signed-in-landing`) remain open in their change folders. Both changes are deliberately left unarchived until those queues drain.
