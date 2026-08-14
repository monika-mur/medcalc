---
project: MedCalc
version: 1
status: mirror
mirrors: context/foundation/roadmap.md
roadmap_version: 1
tracker: linear
workspace: monika-murawska
linear_team_key: MON
linear_team_name: Monika Murawska
linear_project: MedCalc
linear_project_url: https://linear.app/monika-murawska/project/medcalc-151ab227450c
github_mirror: context/foundation/roadmap-github.md
issue_range: MON-5..MON-28
synced_at: 2026-08-11
---

# Roadmap ↔ Linear mirror: MedCalc

> Read-only mirror of how `context/foundation/roadmap.md` (v1) is represented in **Linear**.
> **`roadmap.md` is the source of truth for scope, sequencing, and `Status`.** This file is the
> lookup table between roadmap IDs and Linear issue identifiers. The GitHub side of the same
> hand-off lives in `roadmap-github.md`. Snapshot verified live via the Linear MCP server on
> `2026-08-08`; issue state below drifts as work lands — re-check before relying on it.

## Workspace and project

- Workspace: `monika-murawska`
- Team: **Monika Murawska** (`MON`) — the only team in the workspace
- Project: [MedCalc](https://linear.app/monika-murawska/project/medcalc-151ab227450c) — project status `Backlog`, created `2026-08-05`
- Mirrored on `2026-08-05` from the GitHub hand-off of `2026-08-02` — 24 issues total: 7 roadmap parents, 10 sub-issues, 1 open question, 6 parked v2 items (`MON-5` … `MON-28`).

`MON-1` … `MON-4` are not part of this mirror — they predate the roadmap hand-off.

## Milestones

Project milestones, mapped 1:1 from the GitHub milestones.

| Milestone     | Issues | Progress | Purpose                                                                                                |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `MVP v1`      | 17     | 0%       | Roadmap v1 MVP: F-01 foundation plus slices S-01…S-06. No target date — the roadmap is not a calendar. |
| `v2 (parked)` | 6      | 0%       | Parked items from `roadmap.md` — explicit PRD non-goals for v1, kept visible as a v2 backlog.          |

`MON-6` (the Open Roadmap Question) carries **no milestone** — it does not block MVP development.

## Workflow states

Team `MON` workflow: `Backlog` → `Todo` → `In Progress` → `In Review` → `Done` (plus `Canceled`, `Duplicate`).

At hand-off only two were used:

| State     | Type        | Issues | Which                                        |
| --------- | ----------- | ------ | -------------------------------------------- |
| `Todo`    | `unstarted` | 6      | F-01 and its five sub-issues (`ready` items) |
| `Backlog` | `backlog`   | 18     | everything else                              |

This mirrors roadmap `Status` **at hand-off time only**. It is not kept in sync as work lands, and roadmap `Status` is never read back from Linear.

## Priorities

Derived from roadmap sequencing, not from a field in `roadmap.md`.

| Priority      | Value | Issues                         | Rationale                                    |
| ------------- | ----- | ------------------------------ | -------------------------------------------- |
| `Urgent`      | 1     | MON-5 (F-01), MON-27 (S-05)    | Root of the dependency graph; the north star |
| `High`        | 2     | MON-13, MON-19, MON-20, MON-21 | The S-01…S-04 main line                      |
| `Medium`      | 3     | MON-28 (S-06)                  | Parallel with the north star, lower priority |
| `Low`         | 4     | MON-7 … MON-12                 | Parked v2                                    |
| `No priority` | 0     | all 10 sub-issues, MON-6       | Priority is carried by the parent            |

## Label scheme

13 roadmap labels recreated verbatim as team labels, plus Linear's built-in `Feature` on slice parents.

| Label               | Meaning                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `roadmap`           | Issue originates from `roadmap.md`. On every one of the 24 mirrored issues.   |
| `foundation`        | Foundation item (F-NN) or its sub-issue — enabler, not user-visible.          |
| `slice`             | Vertical slice parent (S-NN) — user-visible outcome.                          |
| `fr`                | Sub-issue scoped to a single PRD Functional Requirement.                      |
| `Feature`           | Linear built-in type label on slice parents (maps from GitHub `enhancement`). |
| `north-star`        | The validation milestone (S-05 / MON-27 only).                                |
| `ready` / `blocked` | Roadmap readiness at hand-off time. Not auto-synced from dependency state.    |
| `stream:a/b/c`      | Roadmap Stream (see `roadmap.md` → Streams).                                  |
| `parked-v2`         | Parked item, `v2 (parked)` milestone.                                         |
| `question`          | Open Roadmap Question.                                                        |

`Bug` and `Improvement` also exist on the team but are unused by this mirror.

## Roadmap items → Linear issues

Parents carry the roadmap ID in their description header. Prerequisites are wired as native Linear
`blockedBy` relations; sub-issues use native parent/child.

| Roadmap ID | Change ID                    | Linear                                                    | GitHub | Title                                                                                       | Milestone | Priority | State   | Blocked by     |
| ---------- | ---------------------------- | --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- | --------- | -------- | ------- | -------------- |
| F-01       | `domain-schema-foundation`   | [MON-5](https://linear.app/monika-murawska/issue/MON-5)   | #1     | Design domain schema: specialists, medications, dosage-change history, visits (append-only) | MVP v1    | Urgent   | Todo    | —              |
| S-01       | `manage-specialists`         | [MON-13](https://linear.app/monika-murawska/issue/MON-13) | #2     | Add and manage specialists                                                                  | MVP v1    | High     | Backlog | MON-5          |
| S-02       | `manage-medications`         | [MON-19](https://linear.app/monika-murawska/issue/MON-19) | #3     | Add and manage medications (single current dosage)                                          | MVP v1    | High     | Backlog | MON-5, MON-13  |
| S-03       | `manage-doctor-visits`       | [MON-20](https://linear.app/monika-murawska/issue/MON-20) | #4     | Add and manage doctor visits                                                                | MVP v1    | High     | Backlog | MON-5, MON-13  |
| S-04       | `supply-status-dashboard`    | [MON-21](https://linear.app/monika-murawska/issue/MON-21) | #5     | Build the supply-status dashboard                                                           | MVP v1    | High     | Backlog | MON-19, MON-20 |
| S-05 ★     | `mid-supply-dosage-change`   | [MON-27](https://linear.app/monika-murawska/issue/MON-27) | #6     | Support mid-supply dosage changes                                                           | MVP v1    | Urgent   | Backlog | MON-19, MON-21 |
| S-06       | `liquid-medication-tracking` | [MON-28](https://linear.app/monika-murawska/issue/MON-28) | #7     | Track liquid medications                                                                    | MVP v1    | Medium   | Backlog | MON-19, MON-21 |

★ = north star (validation milestone).

### Dependency graph as wired in Linear

Edge list — `X blocks Y` as read back from the `relations` field:

| Issue         | Blocks                 |
| ------------- | ---------------------- |
| MON-5 (F-01)  | MON-13, MON-19, MON-20 |
| MON-13 (S-01) | MON-19, MON-20         |
| MON-19 (S-02) | MON-21, MON-27, MON-28 |
| MON-20 (S-03) | MON-21                 |
| MON-21 (S-04) | MON-27, MON-28         |
| MON-27 (S-05) | — (leaf)               |
| MON-28 (S-06) | — (leaf)               |

Critical path to the north star: `MON-5 → MON-13 → MON-19 → MON-21 → MON-27`.

`blockedBy` is wired for **direct** prerequisites only, exactly as the roadmap's Prerequisites
column states them. F-01 blocks S-01/S-02/S-03 directly; it reaches S-04…S-06 transitively.

## Sub-issues

Native Linear sub-issues. All inherit their parent's milestone; none carry a priority.

| Parent       | Linear                                                    | GitHub | Title                                                                | PRD ref | State | Labels                                    |
| ------------ | --------------------------------------------------------- | ------ | -------------------------------------------------------------------- | ------- | ----- | ----------------------------------------- |
| MON-5 (F-01) | [MON-14](https://linear.app/monika-murawska/issue/MON-14) | #8     | F-01a: Domain schema migration (5 tables, constraints, indexes, RLS) | —       | Todo  | `roadmap` `foundation` `ready` `stream:a` |
| MON-5 (F-01) | [MON-15](https://linear.app/monika-murawska/issue/MON-15) | #9     | F-01b: pgTAP database tests (RLS isolation, append-only, ledger)     | —       | Todo  | `roadmap` `foundation` `ready` `stream:a` |
| MON-5 (F-01) | [MON-16](https://linear.app/monika-murawska/issue/MON-16) | #10    | F-01c: Typed Supabase client and signup timezone capture             | —       | Todo  | `roadmap` `foundation` `ready` `stream:a` |
| MON-5 (F-01) | [MON-17](https://linear.app/monika-murawska/issue/MON-17) | #11    | F-01d: Vitest integration suite and schema documentation             | —       | Todo  | `roadmap` `foundation` `ready` `stream:a` |
| MON-5 (F-01) | [MON-18](https://linear.app/monika-murawska/issue/MON-18) | #12    | F-01e: Push migration to Supabase Cloud                              | —       | Todo  | `roadmap` `foundation` `ready` `stream:a` |

> **F-01's sub-issues are cut by plan phase, not by table.** Re-cut on 2026-08-11 to match the five
> phases of `context/changes/domain-schema-foundation/plan.md`, which builds the whole schema as one
> migration. The previous per-table split implied five migrations, had no task for the `supply_events`
> delta ledger, and left Phases 2–5 unrepresented. Phases are sequential — a → e — stated in each
> issue body rather than as Linear `blockedBy` relations, which this mirror reserves for roadmap-level
> prerequisites. GitHub #8–#12 carry the same cut.
> | MON-19 (S-02) | [MON-22](https://linear.app/monika-murawska/issue/MON-22) | #13 | FR-004: Add-medication form (name, quantity, expiry, dosage, specialist) | FR-004 | Backlog | `roadmap` `fr` `blocked` `stream:a` |
> | MON-19 (S-02) | [MON-23](https://linear.app/monika-murawska/issue/MON-23) | #14 | FR-005: Daily-total dosage entry (units/day) | FR-005 | Backlog | `roadmap` `fr` `blocked` `stream:a` |
> | MON-19 (S-02) | [MON-24](https://linear.app/monika-murawska/issue/MON-24) | #15 | FR-007: Edit and archive a medication (soft delete) | FR-007 | Backlog | `roadmap` `fr` `blocked` `stream:a` |
> | MON-20 (S-03) | [MON-25](https://linear.app/monika-murawska/issue/MON-25) | #16 | FR-009: Add a doctor visit (date + specialist) | FR-009 | Backlog | `roadmap` `fr` `blocked` `stream:b` |
> | MON-20 (S-03) | [MON-26](https://linear.app/monika-murawska/issue/MON-26) | #17 | FR-010: Edit and delete a doctor visit | FR-010 | Backlog | `roadmap` `fr` `blocked` `stream:b` |

S-01 (MON-13), S-04 (MON-21), S-05 (MON-27), and S-06 (MON-28) have no sub-issues — each maps to a
single FR, stated inline in the issue description.

## Open Roadmap Questions

| Roadmap item          | Linear                                                  | GitHub | Title                                                                                          | Milestone | Labels               | Block |
| --------------------- | ------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- | --------- | -------------------- | ----- |
| Competitive landscape | [MON-6](https://linear.app/monika-murawska/issue/MON-6) | #18    | Open question: competitive landscape — are equivalent medication supply calculators available? | —         | `roadmap` `question` | soft  |

Deliberately unmilestoned — it does not block MVP development, only positioning and scope validation before launch.

## Parked (v2)

All carry milestone `v2 (parked)`, priority `Low`, state `Backlog`, labels `roadmap` `parked-v2`.

| Linear                                                    | GitHub | Title                                                             | Roadmap "Parked" entry                     |
| --------------------------------------------------------- | ------ | ----------------------------------------------------------------- | ------------------------------------------ |
| [MON-7](https://linear.app/monika-murawska/issue/MON-7)   | #19    | [v2] Treatment history browsing UI                                | Treatment history browsing UI              |
| [MON-8](https://linear.app/monika-murawska/issue/MON-8)   | #20    | [v2] Push or email notifications (low-supply, approaching-expiry) | Push or email notifications                |
| [MON-9](https://linear.app/monika-murawska/issue/MON-9)   | #21    | [v2] Integration with e-prescription or pharmacy systems          | Integration with e-prescription / pharmacy |
| [MON-10](https://linear.app/monika-murawska/issue/MON-10) | #22    | [v2] Managing medications for other people (caregiver delegation) | Managing medications for other people      |
| [MON-11](https://linear.app/monika-murawska/issue/MON-11) | #23    | [v2] Split dosage entry mode (N units x M times/day)              | Split dosage entry mode                    |
| [MON-12](https://linear.app/monika-murawska/issue/MON-12) | #24    | [v2] Configurable color-status thresholds                         | Configurable color-status thresholds       |

## Issue body shape

Every mirrored issue follows the same description template, so an agent can parse any of them the same way:

```
> **Roadmap item <ID>** · Change ID `<change-id>` · Stream <X> · <Foundation | Vertical slice>
> Mirrors [GitHub #N](...) · Source: roadmap.md (v1, 2026-07-04) → prd.md (v1)

## Outcome
## PRD requirements          (verbatim FR text + rejected-alternative "Socrates" notes)
## Acceptance criteria       (checkbox list; derived from the US when one exists)
## Dependencies              (Blocked by / Parallel with / Unlocks)
## Sub-issues
## Risk / sequencing note
## Definition of done        (ends with: ready to hand to /10x-plan as context/changes/<change-id>/)
```

Each issue also carries a **link attachment** back to its GitHub counterpart, titled `GitHub #N`.
Linear auto-generates a git branch name per issue (e.g. `monikamamaali/mon-5-design-domain-schema-…`) —
not used by the repo's branch convention (`feat/`, `fix/`, `chore/` per `CLAUDE.md`).

## Linear fields deliberately left empty

- **Assignee** — nothing assigned; single-developer project, the backlog is the queue.
- **Estimate** — no points on any issue. `roadmap.md` is explicitly not a calendar estimate.
- **Cycles** — no cycles configured; sequencing lives in the `blockedBy` graph, not in time boxes.
- **Due dates** — none, same reason as estimates.
- **Project status updates / documents** — none; `context/foundation/` is the narrative home.

## Not mirrored (deliberate)

- **FR-001 / FR-002 (register, log in/out)** — already satisfied by the Supabase Auth baseline (`roadmap.md` → Baseline). No issue exists; creating one would imply unstarted work.
- **Vision, North star rationale, Streams, Baseline, Risk narratives** — prose that belongs in `roadmap.md`. Only the per-item slice of it is copied into each issue body.
- **`Status` column** — roadmap `Status` (`ready` / `proposed`) is the roadmap's own field and is **not** synced from Linear workflow state. The `ready` / `blocked` labels and the `Todo` / `Backlog` split capture hand-off-time readiness only, and go stale as work lands.

## Re-syncing this mirror

Via the Linear MCP server:

```
list_issues   project="MedCalc" limit=100 orderBy="createdAt"
              fields=["title","url","status","statusType","labels","parentId","priority","projectMilestone"]
list_milestones  project="MedCalc"
list_issue_labels  team="MON"
get_issue     id="MON-<n>" includeRelations=true     # to re-check a blockedBy chain
```

Update `synced_at` in the frontmatter when you refresh.

If `roadmap.md` gains or drops an item, change `roadmap.md` first, then the trackers, then this file
and `roadmap-github.md`. **Nothing propagates automatically** — GitHub and Linear are two independent
mirrors of the same roadmap, with no sync between them; the only link is the per-issue GitHub attachment.
