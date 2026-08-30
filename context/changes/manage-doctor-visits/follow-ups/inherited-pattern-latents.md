# Follow-up — three latents the visits slice inherited from the S-01 pattern

**Source**: `/10x-impl-review` of S-03, 2026-08-30 (finding F10, report at
`reviews/impl-review.md`). Queued rather than fixed, because each one exists
identically in `manage-specialists` and fixing it in visits alone would leave
two slices diverging on the same pattern — the opposite of what transcribing
S-01's vertical slice was for.

**None of these is a regression.** Each is the S-01 pattern working exactly as
designed, at MVP scale, and each was copied deliberately. This file exists so
that whoever eventually revisits the pattern has them written down in one place,
rather than finding them a third time in S-04.

**Scope note**: fixing any of these touches `src/lib/db/specialists.ts` or
`src/components/specialists/SpecialistsManager.tsx`, which `plan.md` → _What
We're NOT Doing_ puts out of bounds for this slice. They are a pattern-wide
change, ideally taken once, after S-02 and S-03 have both merged and a third
consumer (S-04) shows whether the pattern still holds.

---

## 1. A successful write whose body fails to parse reports failure

**Where**: `src/components/visits/VisitsManager.tsx:154` — and identically at
`src/components/specialists/SpecialistsManager.tsx:102`.

```ts
const saved = (await response.json()) as Visit;
```

This sits inside the outer `try`, so if the response is `2xx` but the body is
truncated or is not JSON, the `SyntaxError` lands in the generic `catch` and the
user is told **"Something went wrong. Please try again."** after a write that
actually committed. The list is left stale until reload, and a user who follows
the instruction and retries creates a duplicate — which this slice permits by
design, so nothing stops it.

Low likelihood: same-origin, our own route, a small JSON body. It is recorded
because the failure is silent-but-wrong rather than merely noisy.

**Shape of a fix**: move the `.json()` parse into its own `try`, and on failure
report success with a "reload to see the change" notice rather than an error —
the write happened, and the UI should not claim otherwise.

## 2. `updated_at` is stamped from the Worker clock, `created_at` from Postgres

**Where**: `src/lib/db/visits.ts:106` — and identically at
`src/lib/db/specialists.ts:109`.

```ts
updated_at: new Date().toISOString(),
```

`created_at` comes from the column's `default now()`, evaluated on the database.
`updated_at` is evaluated on the Worker. The two clocks are not the same clock,
so on a create-then-immediately-update a backwards skew makes `updated_at`
earlier than `created_at`, trips
`visits_updated_at_not_before_created_at`
(`supabase/migrations/20260821182457_grants_updated_at_guard_and_rls_perf.sql:102-104`)
and raises `23514`.

`23514` is not in `VisitErrorKind`'s mapping, so it collapses to `"unknown"` and
surfaces as a 500 with an unexplained "Something went wrong". It does at least
reach the Worker log via `logDbError`, per the lesson _Log the database error
before collapsing it to a domain kind_ — which is precisely the lesson that was
written after this exact failure went undiagnosable in S-01.

**Do not fix this by removing the client-side stamp.** `CLAUDE.md` → _Domain
schema_ records that `updated_at` has no maintainer and is client-writable;
the module stamping it is what keeps a caller-supplied value out. The real fix is
the one that section already names as S-01's open work: give the column a
maintainer, and pair the write path with the CHECK rather than relying on the
application alone.

## 3. `listVisits` is unbounded and the whole result is serialised into the HTML

**Where**: `src/lib/db/visits.ts:52` — and identically in `listSpecialists`.

No `.limit()`, no pagination, and `visits.astro` serialises the full array into
the SSR response as the island's `initialVisits` prop. Every visit a user has
ever recorded ships on every page load, twice over (once in the HTML, once in
the hydration payload).

Correct for the MVP — the PRD's user has a handful of specialists and a visit
every few months. It stops being correct at a few hundred rows, which is a
multi-year horizon for a single user, and `visits_user_visit_date_idx`
(`user_id, visit_date`) already supports the range query a paged version would
issue.

**Shape of a fix**: page the Past group (Upcoming is naturally bounded — nobody
schedules hundreds of future appointments), since Past is the group that grows
without limit. Do not add a `.limit()` without pagination; a silently truncated
history is worse than a slow one.
