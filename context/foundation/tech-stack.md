---
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
---

## Why this stack

MedCalc is a web-app with email/password auth, a 3-week after-hours solo MVP timeline, and no payments, realtime, AI, or background-job signals in the PRD. The `(web-app, js)` recommended default is 10x Astro Starter — Astro 6 + React 19 + TypeScript + Supabase + Cloudflare Pages — which clears all four agent-friendly gates (typed end-to-end, convention-based routing and layout, popular in JS training data, well-documented). Supabase provides auth out of the box, satisfying FR-001/FR-002 with no extra integration work. The standard path was taken: the starter's opinionated full-stack shape minimises the surface the agent must reason about from scratch, which matters on a tight solo timeline. Deployment lands on Cloudflare Pages (the starter's native default), CI on GitHub Actions with auto-deploy-on-merge — both matching starter defaults to keep bootstrapper scaffolding as friction-free as possible.
