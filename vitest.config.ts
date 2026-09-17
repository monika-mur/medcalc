import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Two projects, split by what they need to run rather than by what they cover.
//
// `unit` is pure functions — the supply engine, the exact-decimal helpers, date
// arithmetic, dashboard assembly. No stack, no credentials, no network, so it
// runs with Docker stopped and finishes in about a second. That is the point of
// the split: the arithmetic the PRD guards hardest should be checkable in the
// inner loop without starting anything.
//
// `integration` talks to a running local Supabase stack over PostgREST — the
// exact path the application takes — so it needs real credentials and real
// round-trip time.
//
// `extends: true` on both is load-bearing, not boilerplate: without it a project
// inherits none of the root config, including the `@` alias below, and every
// `@/lib/...` import fails to resolve with an error that reads like a missing
// file rather than a missing setting.
//
// Run one with `--project unit` / `--project integration` (see the `test:unit`
// and `test:integration` scripts); `npm test` runs both.
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Database round-trips through PostgREST, plus a signup per user, are
          // slower than Vitest's 5s default.
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // `.env` already holds SUPABASE_URL / SUPABASE_KEY for the local stack
          // (see CLAUDE.md → Environment setup). The empty prefix loads every key,
          // not just VITE_-prefixed ones.
          env: loadEnv(mode, process.cwd(), ""),
        },
      },
    ],
  },
}));
