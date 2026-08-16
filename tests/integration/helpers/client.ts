import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

/** A schema-typed client, so a mistyped table or column is a compile error. */
export type TestClient = SupabaseClient<Database>;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function requireLocalCredentials(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_KEY must be set (see CLAUDE.md → Environment setup). " +
        "Run `npx supabase start` and copy the printed values into `.env`.",
    );
  }

  // These tests sign up users and write rows. Pointing them at a cloud project
  // would create junk accounts in production, so refuse anything non-local.
  const host = new URL(SUPABASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run integration tests against "${host}". These tests create users and write rows; ` +
        "point SUPABASE_URL at the local stack (http://127.0.0.1:54321) first.",
    );
  }

  return { url: SUPABASE_URL, key: SUPABASE_KEY };
}

/**
 * Creates a client authenticated as a fresh user against the local stack.
 *
 * Each call signs up a new account with a unique email, so two calls give two
 * users whose isolation can be tested against each other. Local email
 * confirmations are disabled (`config.toml` → `[auth.email] enable_confirmations
 * = false`), so signup returns a usable session immediately.
 */
export async function createAuthenticatedClient(label: string): Promise<{ client: TestClient; userId: string }> {
  const { url, key } = requireLocalCredentials();

  const client = createClient<Database>(url, key, {
    auth: {
      // Each client keeps its own in-memory session; nothing is persisted
      // between test runs.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const email = `${label}-${crypto.randomUUID()}@medcalc.test`;
  const { data, error } = await client.auth.signUp({ email, password: "test-password-123" });

  if (error) {
    throw new Error(`Signup failed for ${label}: ${error.message}`);
  }
  if (!data.user || !data.session) {
    throw new Error(`Signup for ${label} returned no session — is [auth.email] enable_confirmations still false?`);
  }

  return { client, userId: data.user.id };
}
