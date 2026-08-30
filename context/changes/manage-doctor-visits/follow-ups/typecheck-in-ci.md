# Follow-up — wire `npm run typecheck` into CI

**Source**: `/10x-impl-review` of S-03, 2026-08-30 (finding F6, report at
`reviews/impl-review.md`). Queued rather than fixed, because `.github/workflows/ci.yml`
is a shared file and this slice merges second — see `plan.md` → _Merge order_.

## What it is

Phase 1 §5 added `"typecheck": "astro check"` to `package.json:9`, with the
stated intent of making the type gate "a named script instead of a remembered
incantation, since both phases gate on it". That closed a follow-up raised in
F-01 and never actioned.

The script is now named. It is still not **enforced**. `ci.yml` runs:

```yaml
- run: npm run lint # :20
- run: npm run build # :21
```

and nothing else that type-checks. **`astro build` does not run `astro check`** —
the two are separate commands, and the build's own transform step does not
type-check `.astro` frontmatter or the islands. So a type regression in
`visits.astro`, `VisitsManager.tsx`, or any future page passes CI and deploys:
the `Deploy to production` step at `:25-29` fires on every push to `master`.

Both S-03 phases were verified at "0 errors, 0 warnings" on `typecheck` by hand.
Nothing carries that forward for the next change.

## What to do

One line, after the existing lint step:

```yaml
- run: npm run typecheck
```

Place it **before** `npm run build`, so a type failure short-circuits ahead of
the slower step and ahead of the deploy.

`npx astro sync` already runs at `:19`, which `astro check` needs for generated
types (`.astro/types.d.ts`), so no extra setup step is required.

## Why it is not done here

`plan.md` → _Merge order_ puts this slice second: S-02 owns the migration and
merges first. `ci.yml` is not on the plan's list of five files S-02 touches, so
a conflict is not expected — but it is a repo-wide gate rather than slice
surface, and changing what CI enforces while another slice is mid-flight can
fail that slice's PR on a rule it never agreed to. Land it as its own change
after both slices merge.

## Watch for

- The current baseline is **0 errors, 0 warnings, 5 hints**. All 5 hints are
  pre-existing `ts(6387)` deprecation notices in `eslint.config.js` (lines 14,
  47, 59, 81, 90) — none in application code. `astro check` exits non-zero on
  errors only, so the hints do not block; do not "fix" them as part of wiring
  this up.
- Whether S-02's merged code also passes `typecheck` cleanly. It was never
  gated on it, and turning the gate on in CI is the moment that would surface.
