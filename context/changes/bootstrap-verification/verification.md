---
bootstrapped_at: 2026-06-05T18:49:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: medcalc
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: medcalc
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

**Why this stack:** MedCalc is a web-app with email/password auth, a 3-week after-hours solo MVP timeline, and no payments, realtime, AI, or background-job signals in the PRD. The `(web-app, js)` recommended default is 10x Astro Starter — Astro 6 + React 19 + TypeScript + Supabase + Cloudflare Pages — which clears all four agent-friendly gates (typed end-to-end, convention-based routing and layout, popular in JS training data, well-documented). Supabase provides auth out of the box, satisfying FR-001/FR-002 with no extra integration work. The standard path was taken: the starter's opinionated full-stack shape minimises the surface the agent must reason about from scratch, which matters on a tight solo timeline. Deployment lands on Cloudflare Pages (the starter's native default), CI on GitHub Actions with auto-deploy-on-merge — both matching starter defaults to keep bootstrapper scaffolding as friction-free as possible.

## Pre-scaffold verification

| Signal      | Value                                              | Severity     | Notes                                               |
| ----------- | -------------------------------------------------- | ------------ | --------------------------------------------------- |
| npm package | not run                                            | n/a          | cmd_template starts with `git clone`; npm step skipped |
| GitHub repo | not run                                            | n/a          | `gh` CLI not found on PATH; check unavailable       |

Recency check unavailable: `gh` CLI not installed. Scaffold proceeded regardless — recency checks are informational only.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: clone starter repo without keeping its git history, then move files up
**Exit code**: 0
**Files moved**: 20 (`.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `astro.config.mjs`, `CLAUDE.md`, `components.json`, `eslint.config.js`, `node_modules/`, `package.json`, `package-lock.json`, `public/`, `README.md`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: moved silently (no prior .gitignore in cwd)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0

#### HIGH findings

- **devalue** v5.6.3–5.8.0 | Advisory GHSA-77vg-94rm-hx3p | DoS via sparse array deserialization | CVSS 7.5 | **transitive** (not a direct dependency) | Fix available (update devalue past 5.8.0)

#### MODERATE findings

- **@astrojs/check** ≥0.9.3 | **direct** | via @astrojs/language-server → volar-service-yaml → yaml-language-server → yaml chain | Fix: downgrade to @astrojs/check@0.9.2 (breaking/major)
- **wrangler** ≤0.0.0-kickoff-demo or 3.108.0–4.93.0 | **direct** | via miniflare → ws chain | Fix available (update wrangler)
- **@astrojs/language-server** ≥2.14.0 | transitive (via @astrojs/check) | same chain as above
- **@cloudflare/vite-plugin** (range) | transitive (via miniflare/wrangler/ws) | Fix available
- **miniflare** (range) | transitive (via ws) | Fix available
- **volar-service-yaml** ≤0.0.70 | transitive | Fix: downgrade @astrojs/check
- **ws** 8.0.0–8.20.0 | Advisory GHSA-58qx-3vcg-4xpx | Uninitialized memory disclosure | CVSS 4.4 | transitive | Fix available
- **yaml** 2.0.0–2.8.2 | Advisory GHSA-48c2-rrv3-qjmp | Stack overflow via deeply nested YAML | CVSS 4.3 | transitive | Fix: downgrade @astrojs/check
- **yaml-language-server** (range) | transitive | same chain as yaml above

**Note**: The HIGH finding (devalue) and most MODERATE findings are transitive — they live in your dependency tree but are not directly depended on by your project. The two direct MODERATE packages (`@astrojs/check` and `wrangler`) are dev/build-time tools, not runtime dependencies exposed to end users. Run `npm audit fix` to resolve the wrangler chain; the `@astrojs/check` chain requires a major-version downgrade. Both are low-urgency for an MVP in development.

## Hints recorded but not acted on

| Hint                    | Value               |
| ----------------------- | ------------------- |
| bootstrapper_confidence | first-class         |
| quality_override        | false               |
| path_taken              | standard            |
| self_check_answers      | null                |
| team_size               | solo                |
| deployment_target       | cloudflare-pages    |
| ci_provider             | github-actions      |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                |
| has_payments            | false               |
| has_realtime            | false               |
| has_ai                  | false               |
| has_background_jobs     | false               |

These hints are preserved for the future agent-context skill (CLAUDE.md/AGENTS.md generation), which will act on `has_auth`, `deployment_target`, `ci_provider`, and `ci_default_flow` to produce project-specific agent instructions.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep. (None were created in this run.)
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. The HIGH finding (devalue) and wrangler chain are safe to run `npm audit fix` on; the `@astrojs/check` chain requires a manual major-version decision.
- Copy `.env.example` to `.env` and fill in your Supabase credentials before starting development.
