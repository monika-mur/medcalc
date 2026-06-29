---
name: deploy
description: Deploy to Cloudflare Workers. Use when ready to ship to production.
disable-model-invocation: true
---

Deploy this app to Cloudflare Workers with $ARGUMENTS (optional: environment name or notes).

1. Confirm `.dev.vars` has `SUPABASE_URL` and `SUPABASE_KEY` pointing at the cloud project (not local).
2. Run `npm run build` and confirm it exits 0.
3. Run `npx wrangler deploy`.
4. Note the deployment URL printed by wrangler and confirm the app is reachable.

If production secrets haven't been set in the Cloudflare dashboard yet, set them with:
```
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```
This is a one-time step; after that, `.dev.vars` is only used locally.
