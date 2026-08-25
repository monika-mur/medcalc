// Regenerates src/db/database.types.ts from the local Supabase stack.
//
// Exists because the obvious form of this script is destructive:
//
//   supabase gen types typescript --local > src/db/database.types.ts
//
// The shell truncates the target BEFORE the command runs, so any failure —
// a stopped stack, a container still restarting, a transient CLI hiccup —
// leaves the committed file gutted. That happened on 2026-08-21: the file
// lost 382 lines and lint went to 26 errors, and the recovery was a
// `git checkout`, not anything the script did.
//
// Here the output is buffered and validated first; the target is written only
// on success, so a failed run leaves the previous file exactly as it was.
// The bytes are passed through verbatim (Buffer in, Buffer out, no decode)
// because `npm run db:types` leaving no diff is a Phase 1 success criterion —
// a line-ending translation would break that check without changing meaning.

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TARGET = path.join("src", "db", "database.types.ts");
const COMMAND = "supabase gen types typescript --local";

/** A sentinel that a real generation always contains; a truncated or error output does not. */
const SENTINEL = "export type Database";

/** Well under a real file (~10 KB) but far above any plausible error fragment. */
const MIN_BYTES = 1024;

function fail(message) {
  process.stderr.write(`\ndb:types failed — ${message}\n${TARGET} left unchanged.\n`);
  process.exit(1);
}

async function generate(code, output) {
  if (code !== 0) {
    fail(`\`${COMMAND}\` exited with code ${code}`);
  }

  if (output.length < MIN_BYTES) {
    fail(`output was only ${output.length} bytes — expected at least ${MIN_BYTES}`);
  }

  if (!output.toString("utf8").includes(SENTINEL)) {
    fail(`output did not contain \`${SENTINEL}\` — the stack may not be running`);
  }

  const previous = await readFile(TARGET).catch(() => null);

  // The CLI emits LF. With core.autocrlf=true git checks this file out as
  // CRLF, so writing the CLI's bytes verbatim rewrites every line ending and
  // leaves `git status` reporting a modified file with no content change --
  // which is precisely the signal criterion 1.4 asks a human to read. Match
  // whatever the file on disk already uses instead.
  const wasCrlf = previous?.includes("\r\n") ?? false;
  const payload = wasCrlf ? Buffer.from(output.toString("utf8").replace(/\r?\n/g, "\r\n"), "utf8") : output;

  const unchanged = previous?.equals(payload) ?? false;

  try {
    await writeFile(TARGET, payload);
  } catch (error) {
    // A write that fails partway is the one path that can still leave the
    // target damaged, so it must surface loudly — and it must NOT claim the
    // file is intact, which is the one thing every other failure can promise.
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\ndb:types failed while writing ${TARGET} — ${detail}\n`);
    process.stderr.write(`${TARGET} may be incomplete. Check it with \`git diff\` before continuing.\n`);
    process.exit(1);
  }

  process.stdout.write(
    `db:types — wrote ${TARGET} (${payload.length} bytes, ${unchanged ? "no change" : "CHANGED"})\n`,
  );
}

const chunks = [];

// shell: true because `supabase` resolves to a .cmd shim on Windows, which
// spawn cannot execute directly. The command is a fixed string with no
// interpolation, so there is nothing to inject.
const child = spawn(COMMAND, { shell: true, stdio: ["ignore", "pipe", "inherit"] });

child.stdout.on("data", (chunk) => chunks.push(chunk));

child.on("error", (error) => {
  fail(`could not run \`${COMMAND}\` (${error.message})`);
});

child.on("close", (code) => {
  void generate(code, Buffer.concat(chunks));
});
