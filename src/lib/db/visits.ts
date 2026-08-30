import type { Tables } from "@/db/database.types";
import type { SupabaseClient } from "@/lib/supabase";
import type { VisitInput } from "@/lib/validation/visit";

export type Visit = Tables<"visits">;

/**
 * Why a call failed, in domain terms. Postgres error codes and messages stop
 * here: a route maps a kind onto a status and supplies its own message, and
 * never forwards what the database said.
 *
 * Two divergences from `SpecialistErrorKind`:
 *
 * - There is no `still_referenced`. Nothing references `visits`, so a delete
 *   has no failure mode beyond the row not being there.
 * - `invalid_specialist` is new. `visits_specialist_fk` is composite on
 *   `(specialist_id, user_id)`, so a `specialist_id` belonging to somebody else
 *   fails it — which is a bad value in a form field, not a conflict.
 */
export type VisitErrorKind = "not_found" | "invalid_specialist" | "unknown";

export type Result<T> = { ok: true; data: T } | { ok: false; error: VisitErrorKind };

/** `foreign_key_violation` — here, raised by the composite specialist FK. */
const FK_VIOLATION = "23503";

/**
 * Collapsing a Postgres error to a domain kind discards its code, message and
 * hint, and Workers observability (`wrangler.jsonc` → `observability.enabled`)
 * is the only place a 500 on this path is visible at all. Log before
 * discarding, or an incident here leaves no trace anywhere. Only genuinely
 * unexpected failures come through — `invalid_specialist` is a domain outcome,
 * not an incident, so it is answered without a log line.
 */
function logDbError(operation: string, error: { code: string; message: string }): void {
  // eslint-disable-next-line no-console -- console is the Workers log sink; `no-console` is a repo preference, not a ban.
  console.error(`visits.${operation}`, { code: error.code, message: error.message });
}

/**
 * No function here filters by `user_id`. RLS does that, and a redundant filter
 * would hide a policy regression from any test that looks for one.
 */

/**
 * No embed. The specialist's name is resolved in the island from the list the
 * page already fetches to populate the `<select>`, and `ON DELETE RESTRICT`
 * guarantees every visit's `specialist_id` appears in it — so the lookup is
 * exact rather than a heuristic, and no join is needed to render a row.
 */
export async function listVisits(client: SupabaseClient): Promise<Result<Visit[]>> {
  // `created_at` is the tiebreak, not decoration: duplicates are legal here (no
  // unique constraint by decision), and ordering by `visit_date` alone leaves a
  // same-date pair in whatever order Postgres happened to return, so the two
  // rows would swap places across a refresh.
  const { data, error } = await client.from("visits").select("*").order("visit_date").order("created_at");

  if (error) {
    logDbError("list", error);
    return { ok: false, error: "unknown" };
  }
  return { ok: true, data };
}

/**
 * `id`, `user_id`, `created_at` and `updated_at` all come from column defaults
 * — `user_id` from `default auth.uid()`, matching the schema's design — and are
 * never passed. See `updateVisit` for why the payload is built field by field
 * rather than spread.
 */
export async function createVisit(client: SupabaseClient, input: VisitInput): Promise<Result<Visit>> {
  const { data, error } = await client
    .from("visits")
    .insert({ specialist_id: input.specialist_id, visit_date: input.visit_date })
    .select()
    .single();

  if (error) {
    if (error.code === FK_VIOLATION) {
      return { ok: false, error: "invalid_specialist" };
    }
    logDbError("create", error);
    return { ok: false, error: "unknown" };
  }
  return { ok: true, data };
}

/**
 * **The payload is constructed explicitly and must never be spread from a
 * request body.** The UPDATE policies constrain no columns and
 * `database.types.ts` exposes `updated_at` on `Update`, so a client could set it
 * to any future value; `visits_updated_at_not_before_created_at` closes only the
 * backdating half. There is no database-level alternative — revoking column
 * UPDATE would block this very write, which runs as `authenticated` too, and a
 * trigger is ruled out by the schema's no-procedural-code property. See
 * `src/lib/db/specialists.ts:82-98` for the full argument; it applies here
 * unchanged. So `.update({ ...input })` on this path is a defect regardless of
 * whether anything currently fails.
 *
 * `.select()` is chained because under RLS an UPDATE against a missing or
 * foreign `id` matches zero rows and returns success with no error. An empty
 * result is the only signal that the row was not there.
 */
export async function updateVisit(client: SupabaseClient, id: string, input: VisitInput): Promise<Result<Visit>> {
  const { data, error } = await client
    .from("visits")
    .update({
      specialist_id: input.specialist_id,
      visit_date: input.visit_date,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select();

  if (error) {
    if (error.code === FK_VIOLATION) {
      return { ok: false, error: "invalid_specialist" };
    }
    logDbError("update", error);
    return { ok: false, error: "unknown" };
  }

  const row = data.at(0);
  if (!row) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, data: row };
}

/**
 * Nothing references `visits`, so there is no `23503` path here and no 409.
 * As with `updateVisit`, `.select()` distinguishes "deleted" from the zero-rows
 * success RLS returns for a missing or foreign `id`.
 */
export async function deleteVisit(client: SupabaseClient, id: string): Promise<Result<null>> {
  const { data, error } = await client.from("visits").delete().eq("id", id).select("id");

  if (error) {
    logDbError("delete", error);
    return { ok: false, error: "unknown" };
  }
  if (data.length === 0) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, data: null };
}
