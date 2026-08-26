# Follow-ups — manage-specialists

Queued during S-01 but deliberately not built here. Each entry names where it
came from so the reasoning stays findable after this change is archived.

## Signed-in users still get the signed-out landing page

**Source**: raised by the developer at the Phase 4 manual gate, 2026-08-26,
while walking the sign-in flow. Not a review finding — nothing had exercised the
already-signed-in case before, because `/` was starter content until Phase 2
replaced it.

**The symptom**: visiting `/` while signed in renders the marketing landing page
with **Sign in** and **Sign up** call-to-action buttons. Both are dead ends for a
user who already has a session: `/auth/signin` and `/auth/signup` render their
forms regardless of `Astro.locals.user`. Submitting either one is worse than
useless — a second `signInWithPassword` against a live session, or a signup
attempt that fails on the duplicate email.

Only the Topbar tells the truth on that page: it already branches on `user` and
shows the email plus **Dashboard** / **Specialists** / **Sign out**. So the same
screen simultaneously says "you are signed in as X" and "sign in".

**Why it was not fixed in S-01**: it is an auth-flow concern, not a specialists
concern, and it arrived after every Phase 4 row was verified. Folding a
middleware change into the phase that closed the slice would have meant
re-walking the auth screens to prove nothing regressed. The related one-line
correction that _was_ taken — sign-in redirecting to `/dashboard` instead of `/`
— is what makes this reachable less often, but it does not close it: the user
can still navigate to `/` directly, or arrive from a bookmark or the browser's
back button.

**What to do**. The mechanism already exists — `src/middleware.ts` has
`PROTECTED_ROUTES`, which redirects to `/auth/signin` when `context.locals.user`
is absent. This is the mirror of that: a set of routes that redirect **to**
`/dashboard` when `context.locals.user` is **present**.

1. Add a `GUEST_ONLY_ROUTES` array alongside `PROTECTED_ROUTES` in
   `src/middleware.ts` — `/auth/signin` and `/auth/signup` at minimum. Apply the
   same `startsWith` prefix match, and redirect a signed-in visitor to
   `/dashboard`.
2. **Do not put `/auth/confirm-email` in it.** That page is reached immediately
   after signup, and whether a session exists at that moment depends on whether
   email confirmations are enabled — which differs between the local stack
   (`enable_confirmations = false`, so a session exists) and any environment that
   turns them on. Redirecting it would break the local signup flow, and the
   Phase 2 criterion 2.12 walks that path.
3. Decide `/` separately, and probably differently. A redirect there means a
   signed-in user can never see the product's own landing page, which is a real
   cost once there is marketing copy worth reading. The lighter fix is to branch
   the call-to-action buttons in `src/components/Welcome.astro` on
   `Astro.locals.user` — **Go to dashboard** when signed in, **Sign in / Sign
   up** when not — leaving the page itself reachable. That also removes the
   contradiction with the Topbar, which is the actual defect.
4. Update `CLAUDE.md` → _Auth & route protection_, which currently documents only
   the protected-route direction. Whoever adds `GUEST_ONLY_ROUTES` should record
   that new routes are registered there rather than inside page components — the
   same rule the protected side already carries.

**Verify with**: signed in, visit `/auth/signin` and `/auth/signup` directly and
confirm both land on `/dashboard`; signed out, confirm both still render their
forms and still submit. Then re-walk a real signup end to end against the local
stack, since step 2 is the part most likely to be got wrong — the confirm-email
page is the one that must stay reachable with a session.
