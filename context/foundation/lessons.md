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
Match the line-ending convention the target already uses rather than writing the
tool's bytes verbatim: under `core.autocrlf=true` a verbatim LF write rewrites
every line ending and reports as modified with no content change, which inverts
the "regenerating leaves no diff" signal it is supposed to preserve. See
`scripts/gen-db-types.mjs`.

**Applies to**: plan, plan-review, implement, impl-review

## Hand Studio plain SQL statements, never dollar-quoted blocks

**Context**: Any SQL written to be pasted into Supabase Studio's SQL editor —
manual verification steps, migration rehearsals, ad-hoc checks, seed snippets.
Distinct from SQL that reaches the server as a file: `supabase db reset`,
`supabase test db`, and `psql -f` all send the text intact and are unaffected.

**Problem**: Studio's SQL editor splits the buffer on `;` client-side before
sending. A `DO $$ … $$` body is full of semicolons, so it arrives as fragments
and the tail — `end loop; end $$;` — is parsed as a statement of its own,
raising `42601 syntax error at or near "end"`. The error is doubly misleading:
the SQL is valid, and the reported line number refers to the fragment rather
than to what was pasted, so it sends you hunting for a syntax bug that does not
exist. It cost a round trip on 2026-08-25, on Phase 1 step 1.6 of
`manage-specialists`: a `DO` block with an exception handler, later confirmed to
run clean under `psql`, failed in Studio. It had been authored while Docker was
down and shipped untested, so nothing caught it before the developer did.

**Rule**: SQL destined for the Studio editor must be plain statements — no `DO`
blocks, no `create function` bodies, nothing dollar-quoted. Where the check
needs iteration or exception handling, split it into one self-contained snippet
per case and let the raised error be the pass condition, naming the exact error
text to expect. Verify it in the target tool before handing it over: a block
that runs clean under `docker exec -i supabase_db_<project> psql -U postgres` is
not thereby confirmed for Studio.

**Applies to**: plan, plan-review, implement, impl-review

## Never run a production build against a live dev server

**Context**: Any phase whose success criteria include both `npm run build` and a
browser walk — which is most UI phases here. The shape to recognise is `astro
dev` already serving on 4321, left up for manual verification, while `npm run
build` is run in another shell to tick an automated criterion. Applies equally
to any Vite-backed dev server, not just Astro's.

**Problem**: Both commands share `node_modules/.vite`. The build rewrites
`deps_ssr/` while the dev server is still holding module references into the old
bundle, so the running process ends up with a torn dependency graph — typically
two React copies, or a `react-dom/server` chunk mismatched against `react`. On
2026-08-26, during Phase 4 of `manage-specialists`, this took `/auth/signin`
from working to **HTTP 200 with a zero-byte body**: SSR was throwing
`TypeError: Cannot read properties of null (reading 'useHostTransitionStatus')`
inside `useFormStatus`. The developer saw only a blank page.

The trap is where the stack trace points. It named `SubmitButton.tsx:12` — a
file untouched for two phases — so it reads as "the component I am working on
broke" and invites debugging application code that is provably fine. Nothing in
the phase's diff was on that path. The build had also _passed_, twice, so the
automated criteria were green while the app was unservable. Total cost was one
round trip with the developer plus the time to trace a React-internals error
back to a cache.

**Rule**: Stop the dev server before running `npm run build`, or run the build
first and start the dev server after. Never overlap them. When a running dev
server starts throwing errors inside React, Vite, or another dependency's
internals — especially naming a file the current change never touched —
restart it before reading any application code; if a build ran during its
lifetime, the cache is the suspect, not the component. A blank page served as
`200` with an empty body is this failure's signature, since the error happens
mid-render after the status line is committed.

**Applies to**: implement, impl-review
