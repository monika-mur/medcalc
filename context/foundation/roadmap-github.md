---
project: MedCalc
version: 1
status: mirror
mirrors: context/foundation/roadmap.md
roadmap_version: 1
repo: monika-mur/medcalc
issues_url: https://github.com/monika-mur/medcalc/issues
linear_team: MON
linear_project_url: https://linear.app/monika-murawska/project/medcalc-151ab227450c
synced_at: 2026-08-11
---

# Roadmap ↔ tracker mirror: MedCalc

> Read-only mirror of how `context/foundation/roadmap.md` (v1) is represented in GitHub Issues
> and in Linear. **`roadmap.md` is the source of truth for scope, sequencing, and `Status`.**
> This file is the lookup table between roadmap IDs and tracker IDs. Snapshot taken `2026-08-05`;
> issue state below can drift — re-check with `gh issue list` / Linear before relying on it.

## Repository

- Repo: <https://github.com/monika-mur/medcalc>
- Issues: <https://github.com/monika-mur/medcalc/issues>
- Handed off: `2026-08-02` — 24 issues total (7 roadmap parents, 10 sub-issues, 1 open question, 6 parked v2 items).

## Milestones

| Milestone     | #   | State | Open | Closed | Purpose                                                                                              |
| ------------- | --- | ----- | ---- | ------ | ---------------------------------------------------------------------------------------------------- |
| `MVP v1`      | 1   | open  | 17   | 0      | Roadmap v1 MVP: F-01 foundation plus slices S-01..S-06. No due date — the roadmap is not a calendar. |
| `v2 (parked)` | 2   | open  | 6    | 0      | Parked items from `roadmap.md` — explicit PRD non-goals for v1, kept visible as a v2 backlog.        |

## Label scheme

| Label               | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `roadmap`           | Issue originates from `roadmap.md`. On every mirrored issue.               |
| `foundation`        | Foundation item (F-NN) or its sub-issue — enabler, not user-visible.       |
| `slice`             | Vertical slice parent (S-NN) — user-visible outcome.                       |
| `fr`                | Sub-issue scoped to a single PRD Functional Requirement.                   |
| `enhancement`       | GitHub default type label, applied to slice parents.                       |
| `north-star`        | The validation milestone (S-05 only).                                      |
| `ready` / `blocked` | Roadmap readiness at hand-off time. Not auto-synced from dependency state. |
| `stream:a/b/c`      | Roadmap Stream (see `roadmap.md` → Streams).                               |
| `parked-v2`         | Parked item, `v2 (parked)` milestone.                                      |
| `question`          | Open Roadmap Question.                                                     |

## Roadmap items → issues

Parents carry the roadmap ID; sub-issues are native GitHub sub-issues of their parent.
Prerequisites are wired as native GitHub `blocked by` dependencies.

| Roadmap ID | Change ID                    | Issue                                                | Title                                                                                       | Milestone | Labels                                                            | Prereqs (→ `blocked by`) |
| ---------- | ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------- | ------------------------ |
| F-01       | `domain-schema-foundation`   | [#1](https://github.com/monika-mur/medcalc/issues/1) | Design domain schema: specialists, medications, dosage-change history, visits (append-only) | MVP v1    | `roadmap` `foundation` `ready` `stream:a`                         | —                        |
| S-01       | `manage-specialists`         | [#2](https://github.com/monika-mur/medcalc/issues/2) | Add and manage specialists                                                                  | MVP v1    | `roadmap` `slice` `enhancement` `blocked` `stream:a`              | #1                       |
| S-02       | `manage-medications`         | [#3](https://github.com/monika-mur/medcalc/issues/3) | Add and manage medications (single current dosage)                                          | MVP v1    | `roadmap` `slice` `enhancement` `blocked` `stream:a`              | #1, #2                   |
| S-03       | `manage-doctor-visits`       | [#4](https://github.com/monika-mur/medcalc/issues/4) | Add and manage doctor visits                                                                | MVP v1    | `roadmap` `slice` `enhancement` `blocked` `stream:b`              | #1, #2                   |
| S-04       | `supply-status-dashboard`    | [#5](https://github.com/monika-mur/medcalc/issues/5) | Build the supply-status dashboard                                                           | MVP v1    | `roadmap` `slice` `enhancement` `blocked` `stream:a`              | #3, #4                   |
| S-05 ★     | `mid-supply-dosage-change`   | [#6](https://github.com/monika-mur/medcalc/issues/6) | Support mid-supply dosage changes                                                           | MVP v1    | `roadmap` `slice` `enhancement` `north-star` `blocked` `stream:a` | #3, #5                   |
| S-06       | `liquid-medication-tracking` | [#7](https://github.com/monika-mur/medcalc/issues/7) | Track liquid medications                                                                    | MVP v1    | `roadmap` `slice` `enhancement` `blocked` `stream:c`              | #3, #5                   |

★ = north star (validation milestone).

## Sub-issues

| Parent    | Sub-issue                                              | Title                                                                | PRD ref | Labels                                    |
| --------- | ------------------------------------------------------ | -------------------------------------------------------------------- | ------- | ----------------------------------------- |
| #1 (F-01) | [#8](https://github.com/monika-mur/medcalc/issues/8)   | F-01a: Domain schema migration (5 tables, constraints, indexes, RLS) | —       | `roadmap` `foundation` `ready` `stream:a` |
| #1 (F-01) | [#9](https://github.com/monika-mur/medcalc/issues/9)   | F-01b: pgTAP database tests (RLS isolation, append-only, ledger)     | —       | `roadmap` `foundation` `ready` `stream:a` |
| #1 (F-01) | [#10](https://github.com/monika-mur/medcalc/issues/10) | F-01c: Typed Supabase client and signup timezone capture             | —       | `roadmap` `foundation` `ready` `stream:a` |
| #1 (F-01) | [#11](https://github.com/monika-mur/medcalc/issues/11) | F-01d: Vitest integration suite and schema documentation             | —       | `roadmap` `foundation` `ready` `stream:a` |
| #1 (F-01) | [#12](https://github.com/monika-mur/medcalc/issues/12) | F-01e: Push migration to Supabase Cloud                              | —       | `roadmap` `foundation` `ready` `stream:a` |

> **F-01's sub-issues are cut by plan phase, not by table.** They were re-cut on 2026-08-11 to match
> the five phases of `context/changes/domain-schema-foundation/plan.md`, which builds the whole schema
> as one migration. The previous per-table split (`specialists` / `medications` / `dosage_changes` /
> `visits` / RLS) implied five migrations, had no task for the `supply_events` delta ledger, and left
> Phases 2–5 (tests, typed client, Vitest, cloud push) unrepresented. Phases are sequential — a → e —
> and the dependency is stated in each issue body rather than as a `blocked` label, since that label
> means "blocked by another roadmap item" in this scheme.
>
> Mirrored to Linear (MON-14…MON-18) the same day; both trackers carry the phase cut.
> | #3 (S-02) | [#13](https://github.com/monika-mur/medcalc/issues/13) | FR-004: Add-medication form (name, quantity, expiry, dosage, specialist) | FR-004 | `roadmap` `fr` `blocked` `stream:a` |
> | #3 (S-02) | [#14](https://github.com/monika-mur/medcalc/issues/14) | FR-005: Daily-total dosage entry (units/day) | FR-005 | `roadmap` `fr` `blocked` `stream:a` |
> | #3 (S-02) | [#15](https://github.com/monika-mur/medcalc/issues/15) | FR-007: Edit and archive a medication (soft delete) | FR-007 | `roadmap` `fr` `blocked` `stream:a` |
> | #4 (S-03) | [#16](https://github.com/monika-mur/medcalc/issues/16) | FR-009: Add a doctor visit (date + specialist) | FR-009 | `roadmap` `fr` `blocked` `stream:b` |
> | #4 (S-03) | [#17](https://github.com/monika-mur/medcalc/issues/17) | FR-010: Edit and delete a doctor visit | FR-010 | `roadmap` `fr` `blocked` `stream:b` |

S-01, S-04, S-05, and S-06 have no sub-issues — they are tracked as single parents.

## Open Roadmap Questions

| Roadmap item          | Issue                                                  | Title                                                                                          | Labels               | Block |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------- | ----- |
| Competitive landscape | [#18](https://github.com/monika-mur/medcalc/issues/18) | Open question: competitive landscape — are equivalent medication supply calculators available? | `roadmap` `question` | soft  |

No milestone — this does not block MVP development, only positioning and scope validation before launch.

## Parked (v2)

All carry milestone `v2 (parked)` and labels `roadmap` `parked-v2`.

| Issue                                                  | Title                                                             | Roadmap "Parked" entry                     |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------ |
| [#19](https://github.com/monika-mur/medcalc/issues/19) | [v2] Treatment history browsing UI                                | Treatment history browsing UI              |
| [#20](https://github.com/monika-mur/medcalc/issues/20) | [v2] Push or email notifications (low-supply, approaching-expiry) | Push or email notifications                |
| [#21](https://github.com/monika-mur/medcalc/issues/21) | [v2] Integration with e-prescription or pharmacy systems          | Integration with e-prescription / pharmacy |
| [#22](https://github.com/monika-mur/medcalc/issues/22) | [v2] Managing medications for other people (caregiver delegation) | Managing medications for other people      |
| [#23](https://github.com/monika-mur/medcalc/issues/23) | [v2] Split dosage entry mode (N units x M times/day)              | Split dosage entry mode                    |
| [#24](https://github.com/monika-mur/medcalc/issues/24) | [v2] Configurable color-status thresholds                         | Configurable color-status thresholds       |

## Not mirrored (deliberate)

- **FR-001 / FR-002 (register, log in/out)** — already satisfied by the Supabase Auth baseline (`roadmap.md` → Baseline). No issue exists; creating one would imply unstarted work.
- **Vision, North star, Streams, Baseline, Risk narratives** — prose that belongs in `roadmap.md`, not in issue bodies.
- **`Status` column** — roadmap `Status` (`ready` / `proposed`) is the roadmap's own field and is **not** synced from GitHub issue state. The `ready` / `blocked` labels capture hand-off-time readiness only and go stale as work lands.

## Linear mirror

Mirrored to Linear on `2026-08-05` — team **Monika Murawska** (`MON`), project [MedCalc](https://linear.app/monika-murawska/project/medcalc-151ab227450c).
Same 24 items, same structure: GitHub milestones → Linear project milestones, GitHub sub-issues → Linear sub-issues, GitHub `blocked by` → Linear `blockedBy` relations. Each Linear issue carries a link attachment back to its GitHub issue.

> **F-01a…F-01e re-cut by plan phase on 2026-08-11**, in both trackers on the same day. The ID mapping
> below is unchanged (#8 ↔ MON-14, and so on); only titles and bodies moved. Every other row is untouched.

| Roadmap ID             | GitHub | Linear | Milestone   | Priority |
| ---------------------- | ------ | ------ | ----------- | -------- |
| F-01                   | #1     | MON-5  | MVP v1      | Urgent   |
| F-01a                  | #8     | MON-14 | MVP v1      | —        |
| F-01b                  | #9     | MON-15 | MVP v1      | —        |
| F-01c                  | #10    | MON-16 | MVP v1      | —        |
| F-01d                  | #11    | MON-17 | MVP v1      | —        |
| F-01e                  | #12    | MON-18 | MVP v1      | —        |
| S-01                   | #2     | MON-13 | MVP v1      | High     |
| S-02                   | #3     | MON-19 | MVP v1      | High     |
| S-02 / FR-004          | #13    | MON-22 | MVP v1      | —        |
| S-02 / FR-005          | #14    | MON-23 | MVP v1      | —        |
| S-02 / FR-007          | #15    | MON-24 | MVP v1      | —        |
| S-03                   | #4     | MON-20 | MVP v1      | High     |
| S-03 / FR-009          | #16    | MON-25 | MVP v1      | —        |
| S-03 / FR-010          | #17    | MON-26 | MVP v1      | —        |
| S-04                   | #5     | MON-21 | MVP v1      | High     |
| S-05 ★                 | #6     | MON-27 | MVP v1      | Urgent   |
| S-06                   | #7     | MON-28 | MVP v1      | Medium   |
| Open question          | #18    | MON-6  | —           | —        |
| Parked: history UI     | #19    | MON-7  | v2 (parked) | Low      |
| Parked: notifications  | #20    | MON-8  | v2 (parked) | Low      |
| Parked: e-prescription | #21    | MON-9  | v2 (parked) | Low      |
| Parked: caregiver      | #22    | MON-10 | v2 (parked) | Low      |
| Parked: split dosage   | #23    | MON-11 | v2 (parked) | Low      |
| Parked: thresholds     | #24    | MON-12 | v2 (parked) | Low      |

**Linear-only conventions** (no GitHub equivalent, added because Linear has the fields):

- **Workflow state** — `Todo` for the `ready` items (F-01 and its five sub-issues), `Backlog` for everything else. This mirrors roadmap `Status` at hand-off time; like the labels, it is **not** kept in sync as work lands.
- **Priority** — derived from roadmap sequencing, not from the roadmap itself: Urgent = F-01 (root of the graph) and S-05 (north star); High = the S-01…S-04 main line; Medium = S-06; Low = parked v2.
- **`enhancement`** — GitHub's default type label maps onto Linear's built-in `Feature`; the other 12 labels were recreated verbatim as team labels.

## Re-syncing this mirror

```bash
gh issue list --limit 60 --state all \
  --json number,title,state,milestone,labels \
  --jq '.[] | {number, title, state, milestone: .milestone.title, labels: [.labels[].name]}'
gh api repos/monika-mur/medcalc/milestones \
  --jq '.[] | {number, title, state, open_issues, closed_issues}'
```

For Linear, use the MCP server: `list_issues` scoped to project `MedCalc` with fields
`id,title,status,labels,projectMilestone,parentId,priority`, and `get_issue` with
`includeRelations: true` to check the `blockedBy` chains.

Update `synced_at` in the frontmatter when you refresh. If `roadmap.md` gains or drops an item,
change `roadmap.md` first, then the trackers, then this file. **Nothing propagates automatically** —
GitHub and Linear are two independent mirrors of the same roadmap, with no sync between them.
