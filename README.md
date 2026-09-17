# MedCalc

**Will my medication last until my next doctor's visit?**

MedCalc answers that question for someone managing several chronic medications across several prescribing specialists. It is not a reminder app — it does not tell you when to take a pill. It tells you, before you walk into an appointment, which prescriptions you need to ask for.

The hard case it is built around is a **mid-supply dosage change**: a doctor adjusts your dose partway through a supply you already have. The supply-end date moves, and the arithmetic to work out where it moved to is exactly the arithmetic people get wrong by hand. MedCalc computes it segmentally — the old dose applies until the change takes effect, the new dose after — so a dose scheduled for next Monday is reflected in today's status.

Live at **https://medcalc.medcalc.workers.dev**

## What it does

- **Specialists** — record the doctors you see, so each medication knows who prescribes it.
- **Medications** — name, quantity on hand, printed expiry date, daily dosage, assigned specialist. Removal archives rather than deletes; the history is kept.
- **Doctor visits** — a date plus a specialist, per appointment.
- **Supply-status dashboard** — per medication, the calculated supply-end date and a colour status against the next visit with that medication's specialist: **green** (supply outlasts the visit by more than 14 days), **yellow** (by 1–14 days), **red** (runs out on or before the visit, or the medication expires first). Medications whose specialist has no upcoming visit read "no visit scheduled" rather than showing a stale status.
- **Scheduled dosage changes** — a new daily amount with a future effective date; the dashboard recalculates immediately.

Liquid-medication tracking (container capacity, post-opening expiry) is specified and not yet built. Reminders, treatment history and split dosing are deliberately out of scope for v1.

## How it is built

- [Astro](https://astro.build/) v6 in `server` (SSR) mode — not a static site
- [React](https://react.dev/) v19 for the interactive islands
- [TypeScript](https://www.typescriptlang.org/) v5, strict, with project-service type checking
- [Tailwind CSS](https://tailwindcss.com/) v4 and [shadcn/ui](https://ui.shadcn.com/) (`new-york`)
- [Supabase](https://supabase.com/) — Postgres and Auth, with row-level security carrying the authorization
- [Cloudflare Workers](https://workers.cloudflare.com/) for deployment

Two properties of the data model are worth knowing before changing anything.

**There is no cached current state.** Dosage lives only in `dosage_changes`, quantity only in `supply_events` deltas. There is no `daily_dosage` or `quantity_on_hand` column to drift out of step — the current figures are projected by walking the ledgers. `supply_events` is append-only and `dosage_changes` is immutable once effective; corrections are new rows, never updates.

**The supply calculation lives in one place**, `src/lib/supply.ts`. It is deliberately not a database view and not duplicated in SQL — a second implementation of the PRD's guarded calculation is the failure mode the design is avoiding. The schema carries no triggers, no functions and no RPC by design; new invariants go in CHECK / FK / UNIQUE / RLS.

## Getting started

Requires Node v22.14.0 (see `.nvmrc`), npm, and [Docker](https://www.docker.com/) with ~7 GB RAM for the local Supabase stack.

```bash
git clone https://github.com/monika-mur/medcalc.git
cd medcalc
npm install
```

Start the local Supabase stack:

```bash
npx supabase start
```

Copy `.env.example` to **both** `.env` and `.dev.vars`, then fill in the `API URL` and `anon key` the CLI just printed. Both files are needed: Wrangler reads `.dev.vars` for runtime secrets during `npm run dev`, while `.env` serves the build and the test suites.

```bash
cp .env.example .env
cp .env.example .dev.vars
```

Apply the schema and start the dev server:

```bash
npm run db:reset
npm run dev
```

Local Studio is at `http://localhost:54323`; `npx supabase stop` shuts the stack down.

`SUPABASE_URL` and `SUPABASE_KEY` are declared as server-only secrets in `astro.config.mjs` — they are never exposed to the client, even if imported into a component.

> **Email confirmation** is on by default. To sign in immediately after signing up in local development, turn it off under **Authentication → Email → Confirm email** in Studio.

## Scripts

| Script                      | What it does                                                         |
| --------------------------- | -------------------------------------------------------------------- |
| `npm run dev`               | Dev server on the Cloudflare workerd runtime                         |
| `npm run build`             | Production build                                                     |
| `npm run preview`           | Preview the production build                                         |
| `npm run lint` / `lint:fix` | ESLint with type-checked rules                                       |
| `npm run typecheck`         | `astro check` — the build does **not** type-check on its own         |
| `npm run format`            | Prettier                                                             |
| `npm run test:unit`         | Vitest unit tests — no stack needed, runs with Docker stopped        |
| `npm run test:integration`  | Vitest integration tests — needs the local stack running             |
| `npm test`                  | Both Vitest projects                                                 |
| `npm run db:reset`          | Re-apply all migrations from scratch                                 |
| `npm run db:test`           | pgTAP database tests                                                 |
| `npm run db:types`          | Regenerate `src/db/database.types.ts` (committed, never hand-edited) |

## Testing

Three buckets, chosen by what the code under test touches:

- `tests/unit/` — pure functions with no I/O: the supply engine, exact-decimal arithmetic, date handling, dashboard assembly. Runs in about a second with Docker fully stopped.
- `tests/integration/` — anything crossing PostgREST or `@supabase/supabase-js`, the path the application itself takes. Needs the local stack; the helper refuses to run against a non-local `SUPABASE_URL`, because these tests sign up users and write rows.
- `supabase/tests/` — pgTAP assertions on database-level invariants: RLS policies, CHECK and FK constraints, uniqueness, append-only enforcement.

Both database and client layers earn their keep: pgTAP catches a broken constraint, the integration suite catches a policy targeting the wrong role.

The phased rollout that populates these suites is tracked in `context/foundation/test-plan.md`.

## Project structure

```
src/
  pages/            Astro pages and API routes
    api/            medications, specialists, visits, auth
  components/       React islands and Astro components, by feature
    ui/             shadcn-generated — not edited by hand
    form/           shared form controls — ours to edit
  lib/
    supply.ts       the supply calculation — the single implementation
    dashboard.ts    dashboard assembly
    dates.ts        date resolution; the only place a timezone is interpreted
    decimal.ts      exact decimal arithmetic for numeric columns
    db/             data modules, one per entity
  db/               generated database types
  middleware.ts     route protection via PROTECTED_ROUTES
supabase/
  migrations/       schema history
  tests/            pgTAP tests
tests/              unit and integration suites
context/            product and engineering contracts (PRD, roadmap, plans)
```

`context/` holds the working contracts this project is built against — `foundation/prd.md`, `foundation/roadmap.md`, `foundation/test-plan.md` and the per-change folders under `context/changes/`. `CLAUDE.md` carries the conventions an AI agent needs in order to contribute without breaking them.

## Deployment

Pushes to `master` deploy to Cloudflare Workers automatically via GitHub Actions. The workflow lints, type-checks, builds, and then verifies that every merged migration has actually been applied to the cloud database before it deploys — shipping code that assumes a column or policy the live database lacks is a failure this project has already had once. Applying migrations stays a manual step (`npx supabase db push`).

Pull requests deliberately do not deploy.

To deploy by hand:

```bash
npm run build
npx wrangler deploy --config dist/server/wrangler.json
```

Set `SUPABASE_URL` and `SUPABASE_KEY` via `npx wrangler secret put`, and configure `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_ACCESS_TOKEN` and `CLOUDFLARE_API_TOKEN` as repository secrets in GitHub.

## Acknowledgements

Scaffolded from [10x-astro-starter](https://github.com/przeprogramowani/10x-astro-starter).

## License

MIT
