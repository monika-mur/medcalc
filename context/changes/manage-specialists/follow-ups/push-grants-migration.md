# Follow-ups — manage-specialists

Queued during S-01 but deliberately not built here. Each entry names where it
came from so the reasoning stays findable after this change is archived.

## Push `20260821182457` to cloud — the `anon` revoke is still local-only

**Source**: impl-review finding F4 (WARNING, Scope Discipline), 2026-08-26. The
underlying condition was found earlier, by Phase 1 manual step 1.8 on 2026-08-25,
and analysed in `change.md` → _Post-review: the schema was missing every GRANT_.
Not a defect in this slice — the plan's non-goals correctly exclude pushing to
cloud. This entry exists because nothing else queued the push, and after
`/10x-archive` the analysis would only survive inside an immutable folder.

**The outstanding change**:
`supabase/migrations/20260821182457_grants_updated_at_guard_and_rls_perf.sql:84-88`
issues `revoke … from anon` on all five domain tables. Step 1.9 confirms the
migration is **Local-only**, with an empty Remote column. CI does not apply
migrations (`domain-schema-foundation/follow-ups/review-fixes.md` → F9 is still
queued), so nothing will push it automatically.

**What it changes on cloud, and what it does not.** Every other statement in this
migration is a no-op against cloud — the `GRANT`s restore privileges that project
already holds, and `GRANT` is idempotent. The `revoke` is the one statement with
real effect there: cloud currently grants all four DML privileges to `anon` on
all five tables, inherited from the older Supabase platform default under which
the project was created.

**This is a defence-in-depth gap, not a live breach.** Established at the time
and re-stated here so nobody re-litigates it from scratch: every policy is
`to authenticated` and `anon` matches none, verified by reproducing the cloud
grants locally — as `anon`, SELECT returns 0 rows against a populated table,
INSERT raises `new row violates row-level security policy`, and DELETE reports 0.
RLS holds on its own. What is missing is the second mechanism: production is
protected by one where the design intends two, and the anon key ships in the
client bundle. Disabling RLS on one table in a later migration, or writing a
single policy `to public`, would turn that into full DML from the internet with
nothing behind it.

**The drift it leaves meanwhile**: local returns 5 rows, cloud returns 10, and
the pgTAP `anon` assertions (extended in this slice from `specialists` alone to
all five tables, 66 → 70) keep passing locally while production stays exposed.
A green test suite is not evidence about cloud.

### Verifying — before and after

Run in the cloud project's SQL Editor (dashboard → SQL Editor), which needs no
local credential wiring. Note this query covers **both** roles: the variant in
`plan.md` → _Verifying cloud_ filters `grantee = 'authenticated'` alone, which
answers a different question and would return 5 both before and after the push.

```sql
select table_name,
       grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
group by table_name, grantee
order by table_name, grantee;
```

| When                                  | Expected                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Before the push (measured 2026-08-25) | **10 rows** — five `authenticated`, five `anon`, each reading `DELETE, INSERT, SELECT, UPDATE` |
| After the push                        | **5 rows** — `authenticated` only, unchanged and complete. No `anon` row on any table          |
| Local, today                          | 5 rows, matching the post-push cloud state                                                     |

Anything other than 5 complete `authenticated` rows after the push means the
`GRANT` half did not land — stop, because that is the half the live app depends
on to function at all.

**Then re-check the app**, since this is the one statement here that removes a
privilege from production: sign in, load `/specialists`, and add and delete a
row. All of it runs as `authenticated`, so it should be untouched; confirming
that is cheaper than assuming it.

### Running the push

Remember the proxy and the shell — `lessons.md` → _Write shell commands for
PowerShell_. Set the variable as its own statement, never as a prefix:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
npx supabase migration list
npx supabase db push
```

`migration list` first: it should show `20260821182457` as Local-only, and
`20260813185255` on both sides. If the local-only set has grown beyond this one
migration, read what else would go out before pushing.

**Why this deserves its own session** rather than a triage step: it is the only
non-idempotent statement in the migration against production, and it was never
rehearsed on cloud. Push it deliberately, when someone can watch the app
afterwards — not while finishing something else.
