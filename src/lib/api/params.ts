import { z } from "zod";

const idSchema = z.uuid();

const dateSchema = z.iso.date();

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

/**
 * The `date` path segment, or `null` when it is not a `YYYY-MM-DD` date.
 *
 * `readId`'s reasoning transfers exactly: an unvalidated segment reaches
 * Postgres as `22P02 invalid input syntax for type date` and surfaces as a 500,
 * and the honest answer is the one a well-formed date naming no row gets — a
 * 404. It is a sibling here rather than inline at its one call site because
 * that is the rule this module exists to hold; the id half was inline in a route
 * first too, and `src/pages/api/visits/[id].ts` still carries a copy of it.
 *
 * **No floor.** Callers that address an existing row by date must accept past
 * dates, or a row that has taken effect becomes unaddressable and answers 404
 * for the wrong reason. Whether a given date is allowed is the policy's
 * question, not this parser's.
 */
export function readDateParam(params: Record<string, string | undefined>): string | null {
  const parsed = dateSchema.safeParse(params.date);
  return parsed.success ? parsed.data : null;
}
