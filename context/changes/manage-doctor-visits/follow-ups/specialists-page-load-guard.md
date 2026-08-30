# Follow-up — `specialists.astro` renders an empty list where it should render the notice

**Source**: found while writing `src/pages/visits.astro` during S-03 Phase 2,
2026-08-29. Recorded here rather than fixed, because `plan.md` → _What We're NOT
Doing_ puts `/specialists` out of scope for this slice. It is now known rather
than latent.

## What it is

`src/pages/specialists.astro` sets `loadFailed` only when a query returns an
error:

```
const supabase = createClient(Astro.request.headers, Astro.cookies);
let specialists: SpecialistWithUsage[] = [];
let loadFailed = false;

if (supabase) {
  const result = await listSpecialists(supabase);
  ...
}
```

When `createClient` returns `null` — which it does whenever `SUPABASE_URL` or
`SUPABASE_KEY` is unset (`src/lib/supabase.ts:9-11`) — the `if` is skipped
entirely and the page falls through with `loadFailed = false` and an empty
array. It then renders "no specialists yet" to a user who may well have several.
**A configuration failure is displayed as an empty but healthy list**, which is a
lie the user cannot distinguish from the truth, and there is no notice, no
error, and nothing in the response to suggest anything went wrong.

## Why S-03 diverged instead of inheriting it

`src/pages/visits.astro` sets `let loadFailed = !supabase;` and renders the
zero-specialists prompt only when `!loadFailed`. Inheriting the fall-through
would have been strictly worse there than it is on `/specialists`: an empty
specialist list also drives the "add a specialist first" prompt, so a
misconfigured environment would tell the user they have no specialists and then
link them to a page broken in exactly the same way — a loop with no exit and no
diagnostic. The divergence is deliberate and commented in place; it is not drift
to be reconciled by making `visits.astro` match its neighbour.

## The fix, when someone takes it

One line, mirroring `visits.astro`:

```
let loadFailed = !supabase;
```

The existing bordered notice at `specialists.astro:36-41` already renders on
`loadFailed`, so nothing else changes. Worth doing at the same time as any other
`/specialists` work rather than as a change of its own.

## Scope note

This is the same shape as, but distinct from, the S-03 divergence itself. If a
future slice adds a third page following this pattern, the null-client guard
belongs in whatever both pages come to share, not copied a third time.
