import { z } from "zod";

const idSchema = z.uuid();

/**
 * The `id` path segment, or `null` when it is not a uuid.
 *
 * A non-uuid segment would reach Postgres as `22P02 invalid input syntax` and
 * surface as a 500. It is the same outcome as a uuid that matches nothing —
 * there is no such row — so it is answered the same way, with a 404.
 *
 * The rule and its reasoning are S-01's, from `src/pages/api/specialists/[id].ts`
 * where it was first written inline. It lives here because every id-addressed
 * route in the app needs it and there are now six of them across two entities;
 * `src/lib/api/` is where shared route helpers live, alongside the JSON contract
 * in `./json`.
 */
export function readId(params: Record<string, string | undefined>): string | null {
  const parsed = idSchema.safeParse(params.id);
  return parsed.success ? parsed.data : null;
}
