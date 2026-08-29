import { z } from "zod";

const idSchema = z.uuid();

/**
 * A non-UUID segment would reach Postgres as `22P02 invalid input syntax` and
 * surface as a 500. It is the same outcome as a UUID that matches nothing —
 * there is no such medication — so it is answered the same way. The rule and
 * its reasoning are S-01's, at `src/pages/api/specialists/[id].ts`; it lives in
 * a module here only because four of this slice's five routes are addressed by
 * id and would otherwise carry four copies of it.
 *
 * The leading `_` is what keeps Astro from turning this file into a route.
 */
export function readId(params: Record<string, string | undefined>): string | null {
  const parsed = idSchema.safeParse(params.id);
  return parsed.success ? parsed.data : null;
}
