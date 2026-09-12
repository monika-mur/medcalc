// Fails CI when a migration is merged but has never been applied to the cloud
// project — the "merged but not applied" gap that bit twice in five weeks.
//
// `20260821182457` sat unpushed for 6 days; `20260829071323` for 8, and the
// second one left a live 500 on the same-day dosage edit the whole time. Both
// survived because nothing was watching: the local pgTAP and Vitest suites run
// against a database that HAS the migration, so they pass and always would
// have. A green suite is not evidence about cloud.
//
// This deliberately does NOT apply anything. The F-01 plan decided that
// `db push` stays a manual step, and that decision stands — the defect was
// never that pushing was manual, it was that forgetting was silent.
//
// Talks to the Management API over HTTPS rather than shelling out to the
// Supabase CLI, for three reasons: it needs one credential instead of two (no
// database password), it does not couple CI to the CLI's undocumented JSON
// output or to its version (a CLI bump is what broke the schema on
// 2026-08-21), and it works from networks that block the Postgres port — which
// is how the office connection behaves.
//
// The endpoint is Beta as of 2026-09-06. If it changes shape this script fails
// loudly with the body it got, which is the whole point; a check that degrades
// to silence would reproduce the bug it exists to catch.

import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const MIGRATIONS_DIR = path.join("supabase", "migrations");

/** Leading digits of `20260813185255_domain_schema.sql`. */
const VERSION_PATTERN = /^(\d+)_.*\.sql$/;

const QUERY = "select version from supabase_migrations.schema_migrations order by version;";

function fail(message, detail) {
  process.stderr.write(`\nmigration drift check failed — ${message}\n`);
  if (detail) process.stderr.write(`${detail}\n`);
  process.exit(1);
}

/**
 * Pure so it can be exercised without a network call — the HTTP path is covered
 * by the run against the real project, this half by feeding it a short list.
 *
 * `unknown` (applied on cloud, absent from the repo) is reported as well as
 * `pending`. It means someone applied SQL outside the migration flow, or a
 * migration file was deleted after being applied; either way the repo has
 * stopped describing production and that is worth a red run.
 */
export function diffMigrations(local, remote) {
  const remoteSet = new Set(remote);
  const localSet = new Set(local);
  return {
    pending: local.filter((v) => !remoteSet.has(v)),
    unknown: remote.filter((v) => !localSet.has(v)),
  };
}

async function localVersions() {
  const entries = await readdir(MIGRATIONS_DIR);
  const versions = entries.map((name) => VERSION_PATTERN.exec(name)?.[1]).filter(Boolean);

  // A repo with no migrations would make every comparison below trivially
  // true. That is a broken checkout, not a clean bill of health.
  if (versions.length === 0) {
    fail(`no migration files found under ${MIGRATIONS_DIR}`, "Refusing to report success from an empty set.");
  }
  return versions.sort();
}

async function remoteVersions(ref, token) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, read_only: true }),
  });

  const raw = await response.text();
  if (!response.ok) {
    fail(`Management API returned ${String(response.status)}`, raw.slice(0, 500));
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    fail("Management API response was not JSON", raw.slice(0, 500));
  }

  // Beta endpoint: accept the two documented-ish shapes and refuse to guess at
  // a third. Treating an unrecognised body as "no rows" would report every
  // migration as pending, or worse, report success from a shape we misread.
  const rows = Array.isArray(body) ? body : Array.isArray(body?.result) ? body.result : null;
  if (rows === null) {
    fail("unexpected Management API response shape", JSON.stringify(body).slice(0, 500));
  }

  return rows.map((row) => String(row.version)).sort();
}

async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref) fail("SUPABASE_PROJECT_REF is not set");
  if (!token) fail("SUPABASE_ACCESS_TOKEN is not set");

  const local = await localVersions();
  const remote = await remoteVersions(ref, token);
  const { pending, unknown } = diffMigrations(local, remote);

  if (unknown.length > 0) {
    process.stderr.write(`\nApplied on cloud but absent from ${MIGRATIONS_DIR}:\n`);
    for (const v of unknown) process.stderr.write(`  ${v}\n`);
  }

  if (pending.length > 0) {
    process.stderr.write("\nMerged but never applied to cloud:\n");
    for (const v of pending) process.stderr.write(`  ${v}\n`);
    process.stderr.write(
      "\nDeploy is blocked because the code being deployed may assume these.\n" +
        "Apply them, then re-run this workflow:\n\n" +
        '  $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"\n' +
        "  npx supabase migration list\n" +
        "  npx supabase db push --dry-run\n" +
        "  npx supabase db push\n\n" +
        "If the CLI times out on the pooler host, the network is blocking the\n" +
        "Postgres port — switch to a hotspot rather than debugging TLS.\n",
    );
  }

  if (pending.length > 0 || unknown.length > 0) process.exit(1);

  process.stdout.write(`Migrations in sync: ${String(local.length)} applied on cloud.\n`);
}

// Only run when invoked directly, so the diff helper can be imported in a test.
// `argv[1]` is undefined under `node --input-type=module -e`, which is exactly
// how that test imports it — an unguarded call throws before the test starts.
const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
