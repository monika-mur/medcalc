import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Integration tests only. They talk to a running local Supabase stack over
// PostgREST — the exact path the application takes — so they need real
// credentials and real round-trip time, and they are deliberately NOT unit
// tests of pure functions (there are none to test yet).
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
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
}));
