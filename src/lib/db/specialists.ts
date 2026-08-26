import type { Tables } from "@/db/database.types";
import type { SupabaseClient } from "@/lib/supabase";
import type { SpecialistInput } from "@/lib/validation/specialist";

export type Specialist = Tables<"specialists">;

/** A specialist plus how many medications and visits still point at it. */
export interface SpecialistWithUsage extends Specialist {
  usageCount: number;
}

/**
 * Why a call failed, in domain terms. Postgres error codes and messages stop
 * here: a route maps a kind onto a status and supplies its own message, and
 * never forwards what the database said.
 */
export type SpecialistErrorKind = "not_found" | "still_referenced" | "unknown";

export type Result<T> = { ok: true; data: T } | { ok: false; error: SpecialistErrorKind };

/** `foreign_key_violation` — raised by the `ON DELETE RESTRICT` child FKs. */
const FK_VIOLATION = "23503";

/**
 * No function here filters by `user_id`. RLS does that, and a redundant filter
 * would hide a policy regression from any test that looks for one.
 */

export async function listSpecialists(client: SupabaseClient): Promise<Result<SpecialistWithUsage[]>> {
  // PostgREST resolves both composite FKs — `(specialist_id, user_id)` — without
  // a disambiguating constraint hint, verified against the local stack. Each
  // embed comes back as `[{ count: n }]`, empty-array-free even at zero.
  const { data, error } = await client.from("specialists").select("*, medications(count), visits(count)").order("name");

  if (error) {
    return { ok: false, error: "unknown" };
  }

  return {
    ok: true,
    data: data.map(({ medications, visits, ...specialist }) => ({
      ...specialist,
      usageCount: (medications[0]?.count ?? 0) + (visits[0]?.count ?? 0),
    })),
  };
}

/**
 * `id`, `user_id`, `created_at` and `updated_at` all come from column defaults
 * — `user_id` from `default auth.uid()`, matching the schema's design — and are
 * never passed. See `updateSpecialist` for why the payload is built field by
 * field rather than spread.
 */
export async function createSpecialist(client: SupabaseClient, input: SpecialistInput): Promise<Result<Specialist>> {
  const { data, error } = await client
    .from("specialists")
    .insert({ name: input.name, specialty: input.specialty })
    .select()
    .single();

  if (error) {
    return { ok: false, error: "unknown" };
  }
  return { ok: true, data };
}

/**
 * The maintainer for `updated_at` that F-01 deferred to this slice.
 *
 * **The payload is constructed explicitly and must never be spread from a
 * request body.** Phase 1's `check (updated_at >= created_at)` closes only the
 * backdating half of impl-review F8: the UPDATE policies constrain no columns
 * and `database.types.ts` exposes `updated_at` on `Update`, so a client could
 * still set a future value. There is no database-level alternative — revoking
 * column UPDATE would block this very write, which runs as `authenticated` too,
 * and a trigger is ruled out by the schema's no-procedural-code property. This
 * application path is the only lever, so `.update({ ...input })` anywhere on it
 * is a defect regardless of whether anything currently fails.
 *
 * `.select()` is chained because under RLS an UPDATE against a missing or
 * foreign `id` matches zero rows and returns success with no error. An empty
 * result is the only signal that the row was not there.
 */
export async function updateSpecialist(
  client: SupabaseClient,
  id: string,
  input: SpecialistInput,
): Promise<Result<Specialist>> {
  const { data, error } = await client
    .from("specialists")
    .update({
      name: input.name,
      specialty: input.specialty,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select();

  if (error) {
    return { ok: false, error: "unknown" };
  }

  const row = data.at(0);
  if (!row) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, data: row };
}

/**
 * `medications_specialist_fk` and `visits_specialist_fk` are `ON DELETE
 * RESTRICT`, so the DELETE that RLS permits still raises `23503` when anything
 * references the row. That is the real guarantee behind the UI's disabled
 * delete control, which only reflects a count read at page render.
 *
 * As with `updateSpecialist`, `.select()` distinguishes "deleted" from the
 * zero-rows success RLS returns for a missing or foreign `id`.
 */
export async function deleteSpecialist(client: SupabaseClient, id: string): Promise<Result<null>> {
  const { data, error } = await client.from("specialists").delete().eq("id", id).select("id");

  if (error) {
    return { ok: false, error: error.code === FK_VIOLATION ? "still_referenced" : "unknown" };
  }
  if (data.length === 0) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, data: null };
}
