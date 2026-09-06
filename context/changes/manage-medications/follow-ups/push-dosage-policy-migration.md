# Push `20260829071323` to cloud — the same-day dosage fix is local-only

**Status**: ✅ **RESOLVED 2026-09-06.** Pushed with `npx supabase db push` after
a `--dry-run` confirmed exactly one pending migration, no seeds and no roles —
the same three-condition gate this file specifies below. `migration list` now
shows all three migrations on both Local and Remote.

The defect had been live since S-02 deployed on 2026-08-30. The rest of this
entry is kept as written, because the reasoning is the part worth preserving —
and because the same "merged but never applied" condition will apply to the next
migration until F9 closes it structurally.

**Corporate network note**: the push could not run from the office connection.
`migration list` failed with `failed to connect as temp role: … host=aws-1-eu-central-1.pooler.supabase.com … Connection timed out` — a blocked
Postgres port, not TLS, so `NODE_TLS_REJECT_UNAUTHORIZED` does not help and the
CLI's own `SUPABASE_DB_PASSWORD` hint is a red herring. Switching to a phone
hotspot was enough. Reach for that before reaching for a SQL-Editor workaround,
which would apply the change without recording it in
`supabase_migrations.schema_migrations` and leave the CLI seeing drift.

---

**Originally filed as**: 🔴 OPEN — live production defect. Confirmed 2026-09-06
against the cloud project's SQL Editor: the DELETE policy on `dosage_changes`
was still named `dosage_changes_delete_future_own`. The rename to
`dosage_changes_delete_uncommitted_own` is the last statement of
`supabase/migrations/20260829071323_relax_same_day_dosage_correction.sql`, so
the old name was proof the migration had never run there.

**Source**: not an impl-review finding. Surfaced 2026-09-06 while checking what
blocked S-04. Nothing queued the push when S-02 landed — F-01 recorded its push
in `domain-schema-foundation/change.md` → _What was applied_ and S-01 recorded
its own in `manage-specialists/follow-ups/push-grants-migration.md`, but S-02's
migration has no equivalent entry anywhere in `context/`. `db push` is a
deliberate manual step and CI does not apply migrations
(`domain-schema-foundation/follow-ups/review-fixes.md` → F9 is still queued), so
nothing was going to do it automatically.

## The defect it leaves in production

The migration relaxes the DELETE predicate from `effective_date > current_date`
to `>=`, so today's dosage row can be replaced. `src/lib/db/medications.ts` →
`setDosage` was written against the relaxed policy and does an explicit
DELETE-then-INSERT on today's row — it cannot use `.upsert()`, because that
compiles to `INSERT … ON CONFLICT DO UPDATE` and `dosage_changes` has no UPDATE
policy.

Against the **old** policy still live on cloud, that sequence fails in a way the
code does not anticipate:

1. The DELETE matches zero rows. Under RLS a non-matching DELETE is not an
   error, so `deleteError` is null and `removed` comes back empty.
2. The INSERT then collides with the one-dosage-per-day uniqueness constraint
   and raises `23505`.
3. `23505` is not `FK_VIOLATION`, so `missing` is false and the module returns
   `{ ok: false, error: "unknown" }` → the route maps that to **500**.
4. The compensating restore does not fire either — it is guarded on
   `removed.at(0)`, which is undefined.

**User-visible shape**: changing a medication's dosage on the same day it was
created returns a 500. That is the first-day mistake the migration's own header
calls "the likeliest first-day mistake in the whole slice". Live since S-02
deployed on 2026-08-30.

Every already-past dosage row stays immutable either way, so no data is at risk
and no backfill is involved — this is a policy relaxation against a populated
database.

## Verifying — before and after

Cloud project → SQL Editor. The policy **name** alone answers it; `qual` is
included so the predicate is visible in the same result.

```sql
select policyname, qual
from pg_policies
where schemaname = 'public' and tablename = 'dosage_changes' and cmd = 'DELETE';
```

| When                            | Expected                                                          |
| ------------------------------- | ----------------------------------------------------------------- |
| Before (measured 2026-09-06)    | `dosage_changes_delete_future_own`, predicate `> CURRENT_DATE`     |
| After the push                  | `dosage_changes_delete_uncommitted_own`, predicate `>= CURRENT_DATE` |
| Local, today                    | matches the post-push state                                        |

## Running the push

Remember the proxy and the shell — `lessons.md` → _Write shell commands for
PowerShell_. Set the variable as its own statement, never as a prefix:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

`migration list` first. It should show `20260813185255` and `20260821182457` on
both sides and `20260829071323` as Local-only. **If the local-only set has grown
beyond this one migration, stop and read what else would go out** — that is the
same gate `push-grants-migration.md` applied, and it is the reason this file
exists rather than a one-line instruction.

Run it from a terminal that can answer a prompt: the CLI asks for the database
password when it is not cached, and a non-interactive invocation hangs at
`Initialising login role…` rather than failing cleanly (observed 2026-09-06).

**Then re-check the app**, because this changes behaviour a live route depends
on: sign in, add a medication, and immediately edit its dosage. Before the push
that returns a 500; after it, it should succeed. Confirming is cheaper than
assuming.

## Why this was invisible

The local pgTAP and integration suites both run against a database that has the
migration, so they pass and always would have. A green suite is not evidence
about cloud — the same sentence `push-grants-migration.md` had to write about
the `anon` grants five weeks earlier. Two migrations have now sat unpushed
because nothing structural connects "migration merged" to "migration applied";
F9 (gate CI on the suites, and apply migrations from CI or check for drift) is
where that gets fixed properly.
