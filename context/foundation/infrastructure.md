---
project: MedCalc
researched_at: 2026-06-28
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (V8 isolates, nodejs_compat)
  database: Supabase (external)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The stack is already built for this platform: `@astrojs/cloudflare` adapter is installed, `wrangler.jsonc` is configured with `nodejs_compat` and the Static Assets API binding, and `observability.enabled: true` is already set. Zero adapter migration cost. Deploying anywhere else requires swapping the Astro adapter and rewriting environment variable access patterns — 1–2 days of rework before any feature work starts, which is prohibitive on a 3-week solo MVP timeline. The Workers free tier covers 100k requests/day (well above MVP load), and the platform passes all five agent-friendly criteria (with the MCP server at 0.x pre-GA status noted below).

**Important terminology note:** `wrangler.jsonc` and CLAUDE.md confirm this is a **Cloudflare Workers** deployment (`wrangler deploy`), not Cloudflare Pages (`wrangler pages deploy`). These are different products. The tech-stack.md lists `cloudflare-pages` as a label but the actual configured runtime is Workers with the Static Assets API. The deploy command is `npx wrangler deploy`.

## Platform Comparison

| Platform               | CLI-first                        | Managed / Serverless            | Agent-readable docs                   | Stable deploy API | MCP integration            | Migration cost |
| ---------------------- | -------------------------------- | ------------------------------- | ------------------------------------- | ----------------- | -------------------------- | -------------- |
| **Cloudflare Workers** | Pass                             | Pass                            | Pass — llms.txt ✓                     | Pass              | Partial — pre-GA (0.x)     | **Zero**       |
| **Netlify**            | Partial — no CLI rollback / logs | Pass                            | Pass — llms.txt ✓                     | Pass              | Pass — official MCP server | Very low       |
| **Vercel**             | Pass                             | Pass                            | Partial — no llms.txt confirmed       | Pass              | Pass — MCP GA (June 2026)  | Low            |
| **Fly.io**             | Pass                             | Partial — managed VMs, more ops | Fail — no llms.txt, docs not markdown | Pass              | Fail                       | High           |
| **Railway**            | Pass                             | Pass                            | Partial                               | Pass              | Fail                       | High           |
| **Render**             | Partial — limited CLI            | Pass                            | Fail — web-only docs                  | Partial           | Fail                       | High           |

Soft weights applied: no geographic reach preference (single region) → edge-native bonus removed. No co-location preference (Supabase already external) → no co-location bonus. No existing platform familiarity → no tie-breaker applied. Cost/DX neutral.

Hard filters applied: no persistent connections required → no platforms dropped on that axis. All JS/TS runtime requirements met by every candidate.

Fly.io and Render dropped from shortlist: no MCP integration, docs not agent-readable, and high migration cost make them poor fits versus candidates that already support Astro + a functioning agent toolchain.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Already configured — `@astrojs/cloudflare` adapter, `wrangler.jsonc` with `nodejs_compat` flag and Static Assets API, built-in observability (`observability.enabled: true`). `wrangler tail` for live log streaming; `wrangler rollback [deployment-id]` for deterministic rollbacks. Agent-readable docs confirmed (`developers.cloudflare.com/workers/llms.txt`). MCP server (`cloudflare/mcp-server-cloudflare`) covers Workers, observability, DNS, and AI Gateway — pre-GA (all packages at 0.x as of 2026-06-28) but actively maintained. Free tier: 100k requests/day. Workers Paid plan ($5/month) required in practice due to the 10ms free-tier CPU limit per invocation.

#### 2. Netlify

Migration cost is very low — swap `@astrojs/cloudflare` for `@astrojs/netlify` (one package, one adapter call change; no application code changes since no Cloudflare-specific bindings are used). llms.txt confirmed at `docs.netlify.com/llms.txt`. Official Netlify MCP server with 11 skill areas (including Astro-specific support). Free tier: credit-based, 10k–100k requests costs only 2–20 credits of the 300/month free allowance. Hard gap: no `netlify logs` or `netlify rollback` CLI commands — logs and rollback are dashboard-only operations. 50ms CPU cap on Edge Functions (where Astro middleware runs) could be a constraint for compute-heavy middleware.

#### 3. Vercel

Adapter migration: low effort (swap `@astrojs/cloudflare` → `@astrojs/vercel/serverless`, change env var wiring from `.dev.vars` to `vercel env pull`). Vercel MCP is now GA (June 2026) via `https://mcp.vercel.com` with OAuth auth. Runs real Node.js (no `nodejs_compat` complexity). No llms.txt confirmed independently — docs accessible via the MCP server's search tool. Cold starts present but mitigated by Fluid Compute under sustained traffic. No WebSocket support (request/response only, not needed for this app).

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **`nodejs_compat` does not cover all Node.js APIs.** The flag polyfills common APIs (`Buffer`, `process`, some `crypto`) but any npm package that calls an un-polyfilled Node.js API passes `wrangler dev` (miniflare is permissive) and fails in production with cryptic runtime errors. Every new dependency must be validated against Cloudflare's compatibility matrix.

2. **10ms free-tier CPU limit per invocation is too tight for Astro SSR.** React 19 SSR-rendering a dashboard with 20 medications and date arithmetic can exceed this. The Workers Paid plan ($5/month) is effectively mandatory — but this limit is invisible during local development (miniflare has no cap), so the failure appears first in production.

3. **Preview deploys are not automatic for Workers projects.** Unlike Cloudflare Pages, Workers has no built-in PR preview URL system. Preview environments require manually deploying named environments via CI (`wrangler deploy --env preview`). This is extra CI configuration the other shortlisted platforms provide out of the box.

4. **Preview deploy URLs are publicly accessible by default.** MedCalc handles personal medication data. Preview branches deployed to a public subdomain expose real or realistic data without authentication protection. Cloudflare Access can lock this down but requires additional account setup.

5. **`wrangler.jsonc` worker name is "10x-astro-starter".** The current `name` field must be updated to `medcalc` (or the preferred production name) before first deploy, or the Worker lands in the account under the wrong name and becomes hard to identify in the Cloudflare dashboard.

### Pre-Mortem — How This Could Fail

The team deployed MedCalc to Cloudflare Workers. Everything passed in `wrangler dev` locally. Production launched on Friday.

By Sunday, users reported intermittent 500 errors on the dashboard. `wrangler tail` showed a cryptic "TypeError: X is not a function" from a date-arithmetic helper that internally called a Node.js API not covered by `nodejs_compat`. The error only triggered on certain medication configurations (specifically, liquid medications with post-opening expiry logic). Miniflare's broader polyfills masked it during all local testing.

Diagnosing the root cause took two days: reading the Cloudflare compatibility matrix, grepping transitive dependencies, and deploying test builds to a staging Worker environment (which did not exist until this crisis). During that time, the team also discovered that the `wrangler.jsonc` `name` field still read "10x-astro-starter" — so the broken Worker was deployed under that name, not "medcalc", creating confusion when reviewing the dashboard.

After stabilizing, the team discovered that some preview branches were publicly accessible. A teammate had shared a preview URL in a chat thread, not realizing the route included real test medication data. Setting up Cloudflare Access retroactively required touching the account-level Zero Trust configuration, not just the project.

The app works six months later. But the first two weeks were more turbulent than expected given that "the stack was already configured."

### Unknown Unknowns

- **Miniflare ≠ Production Workers runtime.** Local dev (`wrangler dev`) runs miniflare, which is intentionally more permissive than the production V8 isolate. Treat `wrangler dev` as a logic environment; validate every new npm dependency against the real runtime by deploying to a named staging environment.
- **Workers Paid plan is mandatory for real SSR.** The 10ms free-tier CPU cap will be hit. Budget $5/month from the first deploy.
- **`wrangler.jsonc` `name` field must be updated before first deploy.** The current value `"10x-astro-starter"` will create a Worker under that name in the Cloudflare account. Change it to `"medcalc"` (or your preferred production name) before running `wrangler deploy` for the first time.
- **Observability is already enabled — but log storage is not.** `observability.enabled: true` in `wrangler.jsonc` enables the Workers Logs feature, which streams logs and retains them for 3 days on the paid plan. On the free plan, log access is live-tail only (`wrangler tail`). Verify the account is on the paid plan to get log retention.
- **Preview deployments for Workers require explicit CI setup.** There is no zero-config PR preview URL like Cloudflare Pages or Vercel/Netlify offer. Branch previews require adding a named `[env.preview]` block to `wrangler.jsonc` and a CI step.

## Operational Story

- **Preview deploys:** Not automatic for Workers projects. Add a named environment (`[env.preview]`) in `wrangler.jsonc` and a CI step that runs `wrangler deploy --env preview` on pull request branches. Preview Workers land at `<worker-name>-preview.<account>.workers.dev`. Lock with Cloudflare Access (Zero Trust) before sharing URLs that touch real data.
- **Secrets:** Production secrets (`SUPABASE_URL`, `SUPABASE_KEY`) are set via `wrangler secret put SUPABASE_URL` and stored encrypted in the Cloudflare account. Local dev reads from `.dev.vars` (never committed). Rotation: `wrangler secret put <KEY>` overwrites the value; no downtime required.
- **Rollback:** `wrangler deployments list` to find the prior deployment ID; `wrangler rollback <deployment-id>` to revert. Typical revert time: under 30 seconds. Note: database schema changes (Supabase migrations) do not roll back automatically — code rollback and DB rollback must be coordinated manually.
- **Approval:** Destructive actions (delete a Worker, rotate Cloudflare API token, change routing rules) are human-only — perform in the Cloudflare dashboard, not via the agent. The agent may run `wrangler deploy` and `wrangler rollback` unattended.
- **Logs:** Live log streaming: `wrangler tail`. Retained logs (3-day window on paid plan): Cloudflare dashboard → Workers → your Worker → Logs tab. Cloudflare Logpush to an external sink (e.g., Supabase table) is available on the paid plan if longer retention is needed.

## Risk Register

| Risk                                                                               | Source                              | Likelihood | Impact | Mitigation                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm dependency uses un-polyfilled Node.js API; passes locally, fails in production | Devil's advocate                    | Medium     | High   | Deploy to a named staging Worker and smoke-test each new npm dependency before merging to main. Cross-check packages against Cloudflare's compatibility matrix. |
| 10ms free-tier CPU limit exceeded on SSR render; error appears in production       | Devil's advocate                    | High       | Medium | Enable Workers Paid plan ($5/month) on first deploy — treat it as a project cost, not an optional upgrade.                                                      |
| `wrangler.jsonc` `name` still "10x-astro-starter" at first deploy                  | Devil's advocate                    | High       | Low    | Update `name` to `"medcalc"` in `wrangler.jsonc` before running `wrangler deploy` for the first time.                                                           |
| Preview branch URLs expose real medication data publicly                           | Devil's advocate + Unknown unknowns | Medium     | Medium | Set up Cloudflare Access on the preview Worker subdomain before sharing any preview links.                                                                      |
| Miniflare/production divergence masks runtime errors during development            | Pre-mortem + Unknown unknowns       | Medium     | High   | Maintain a named staging Worker; run integration tests against it, not only miniflare.                                                                          |
| No PR preview URLs out of the box; delayed discovery of regression                 | Pre-mortem                          | Medium     | Low    | Add `[env.preview]` block to `wrangler.jsonc` and CI step in first sprint; don't leave preview workflow for later.                                              |
| Observability gap on free plan (no log retention)                                  | Unknown unknowns                    | High       | Low    | Confirm account is on Workers Paid plan; free plan limits `wrangler tail` to live-only streaming.                                                               |
| Worker name collision if multiple projects share Cloudflare account                | Research finding                    | Low        | Low    | Use namespaced names (`medcalc-prod`, `medcalc-preview`) from day one.                                                                                          |

## Getting Started

The stack is already configured. These steps deploy for the first time:

1. **Update the Worker name** in `wrangler.jsonc`: change `"name": "10x-astro-starter"` to `"name": "medcalc"` (or your preferred production name).

2. **Authenticate with Cloudflare:** Run `npx wrangler login` — opens a browser OAuth flow and stores credentials locally.

3. **Upgrade to Workers Paid plan** in the Cloudflare dashboard (account → Workers & Pages → Plans → Workers Paid, $5/month). Required to avoid the 10ms CPU limit hitting Astro SSR renders.

4. **Set production secrets:** `npx wrangler secret put SUPABASE_URL` then `npx wrangler secret put SUPABASE_KEY` — enter values from your Supabase cloud project when prompted.

5. **Build and deploy:**
   ```bash
   npm run build
   npx wrangler deploy
   ```
   The CLI prints the live Worker URL (e.g., `https://medcalc.<account>.workers.dev`).

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup (GitHub Actions workflow for auto-deploy is a next step, not covered here)
- Production-scale architecture (multi-region, HA, DR)
