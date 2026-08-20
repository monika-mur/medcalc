# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Write shell commands for PowerShell, not for the agent's own Bash tool

**Context**: Any command handed to the developer to run — most often the ones needing `NODE_TLS_REJECT_UNAUTHORIZED=0` behind the corporate TLS-intercepting proxy (`supabase login｜link｜db push｜migration list`, `wrangler deploy｜secret put`). Documented in `CLAUDE.md` → _Commands_ and repeated throughout `context/changes/*/change.md` Phase 5 resume steps.

**Problem**: The developer's shell is PowerShell, which has no POSIX `VAR=value command` prefix. `NODE_TLS_REJECT_UNAUTHORIZED=0 npx supabase logout --yes` fails with _"The term 'NODE_TLS_REJECT_UNAUTHORIZED=0' is not recognized as the name of a cmdlet…"_ before doing anything. The mismatch is invisible from the agent's side because its own Bash tool runs Git Bash, where the prefix form works — so a command that was verified as working still fails when pasted. It propagates: the bash form was written into `CLAUDE.md` → _Commands_, into every `change.md` Phase 5 resume step, and into live conversation during the 2026-08-20 credential rotation, where it blocked a `supabase logout` mid-triage.

**Rule**: Emit shell commands in the developer's shell dialect, not the dialect of the tool used to verify them. For PowerShell, set environment variables as `$env:VAR = "value"` on their own line and never as a command prefix. A command that ran clean under the Bash tool is not thereby confirmed for the developer's terminal.

**Applies to**: all
