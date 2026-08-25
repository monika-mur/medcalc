# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Write shell commands for PowerShell, not for the agent's own Bash tool

**Context**: Any command handed to the developer to run — most often the ones needing `NODE_TLS_REJECT_UNAUTHORIZED=0` behind the corporate TLS-intercepting proxy (`supabase login｜link｜db push｜migration list`, `wrangler deploy｜secret put`). Documented in `CLAUDE.md` → _Commands_ and repeated throughout `context/changes/*/change.md` Phase 5 resume steps.

**Problem**: The developer's shell is PowerShell, which has no POSIX `VAR=value command` prefix. `NODE_TLS_REJECT_UNAUTHORIZED=0 npx supabase logout --yes` fails with _"The term 'NODE_TLS_REJECT_UNAUTHORIZED=0' is not recognized as the name of a cmdlet…"_ before doing anything. The mismatch is invisible from the agent's side because its own Bash tool runs Git Bash, where the prefix form works — so a command that was verified as working still fails when pasted. It propagates: the bash form was written into `CLAUDE.md` → _Commands_, into every `change.md` Phase 5 resume step, and into live conversation during the 2026-08-20 credential rotation, where it blocked a `supabase logout` mid-triage.

**Rule**: Emit shell commands in the developer's shell dialect, not the dialect of the tool used to verify them. For PowerShell, set environment variables as `$env:VAR = "value"` on their own line and never as a command prefix. A command that ran clean under the Bash tool is not thereby confirmed for the developer's terminal.

**Applies to**: all

## State table privileges in the migration; never inherit them from the platform

**Context**: Any migration under `supabase/migrations/` that creates a table in
`public`, and any review of one. Also any pgTAP or integration suite that reads
green because a privilege happened to be present rather than because a migration
put it there.

**Problem**: `20260813185255_domain_schema.sql` created five tables with full RLS
policy sets and issued no `GRANT` at all — a grep finds only two comments
containing the word. It worked for weeks because Supabase historically granted
DML on new `public` tables to `anon` and `authenticated` by default. On
2026-08-21 a routine CLI bump (2.98.2 → 2.115.0) pulled a Postgres image whose
default ACL for the `postgres` role in `public` is `authenticated=Dxtm` — no
SELECT, INSERT, UPDATE or DELETE. Migrations run as `postgres` and the tables are
owned by `postgres`, so a from-scratch `db reset` left every domain table
unreachable and pgTAP fell from 57/57 to 14/57 with `permission denied` on four
of five tables. Nothing in the repo asserted the privileges existed, so nothing
could warn that they were borrowed. The failure also arrived disguised: it looked
like the CLI upgrade broke the schema, when the schema had been incomplete since
the day it was written, and local had silently diverged from a cloud project
created under the older, more permissive default.

**Rule**: A table is not finished until a migration states who may read and write
it — RLS policies grant no privileges, and a passing test proves only that some
privilege is present today, not that your migration put it there. Issue explicit
`GRANT`s alongside every `create table`, and assert them in the test suite
(`table_privs_are`) so an inherited default can never masquerade as a decision.

**Applies to**: plan, plan-review, implement, impl-review

## Never redirect a generator's stdout straight onto a committed file

**Context**: Any npm script, Makefile target, or CI step that regenerates a
committed artifact from a tool — generated types, OpenAPI clients, schema
snapshots, lockfiles. The shape to recognise is `<command> > <tracked file>`,
which in this repo was `db:types`:
`supabase gen types typescript --local > src/db/database.types.ts`.

**Problem**: The shell opens and truncates the target **before** the command
runs, so the destruction happens whether or not the command succeeds. Any
failure — a stopped Docker daemon, a container still restarting, a transient
CLI hiccup — leaves the committed file gutted rather than untouched. On
2026-08-21 the CLI hiccupped seconds after a container restart and
`database.types.ts` lost 382 lines; lint went from clean to 26 errors, and the
recovery was `git checkout`, not anything the script did. The failure is
especially nasty because it is silent about its real cause: the visible symptom
is a wall of type errors in application code, which reads as "my code broke",
not "my generator did not run". Version control is the only thing that made it
recoverable, and only because the file happened to be committed and clean at
the time — mid-edit, the previous content would have been gone.

**Rule**: Never point shell redirection at a tracked file. Buffer the
generator's output, verify it succeeded (exit code zero, plausible size, and a
sentinel string the real output always contains), and write the target only
after all three pass — so a failed run leaves the previous file byte-identical.
Pass bytes through verbatim, without decoding to a string, when a "regenerating
leaves no diff" check is part of the suite. See `scripts/gen-db-types.mjs`.

**Applies to**: plan, plan-review, implement, impl-review
