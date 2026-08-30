import type { APIRoute } from "astro";
import { json, jsonError, readJsonBody, zodFieldErrors } from "@/lib/api/json";
import { readId } from "@/lib/api/params";
import { setDosage } from "@/lib/db/medications";
import { createClient } from "@/lib/supabase";
import { dosageInputSchema } from "@/lib/validation/medication";

/**
 * Records the daily dosage in force today. Its own route because it writes
 * `dosage_changes`, not a column on `medications` — every mutation surface in
 * this slice maps to the table it writes.
 *
 * The body carries no date. `effective_date` is derived in UTC inside the data
 * module, because the DELETE policy compares it against Postgres `current_date`
 * and a caller-supplied local date would disagree for part of every day.
 */
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonError(401, "Sign in to continue");
  }
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "Supabase is not configured");
  }

  const id = readId(context.params);
  if (!id) {
    return jsonError(404, "Medication not found");
  }

  const body = await readJsonBody(context.request);
  if (!body.ok) {
    return jsonError(400, "Request body must be valid JSON");
  }

  // A `daily_dosage` of 0 passes: it is how the user records "I have stopped
  // taking this", which is a legal state distinct from archival — not an error.
  const parsed = dosageInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, "Check the highlighted fields", zodFieldErrors(parsed.error));
  }

  const result = await setDosage(supabase, id, parsed.data.daily_dosage);
  if (!result.ok) {
    if (result.error === "not_found") {
      return jsonError(404, "Medication not found");
    }
    // The module restores the dosage it removed before reporting a failure, so
    // a 500 here honestly means nothing changed.
    return jsonError(500, "Could not save the dosage");
  }
  return json(result.data);
};
