import type { APIRoute } from "astro";
import { json, jsonError, readJsonBody, zodFieldErrors } from "@/lib/api/json";
import { readId } from "@/lib/api/params";
import { resolveToday, resolveTodayForUser } from "@/lib/dates";
import { setDosage } from "@/lib/db/medications";
import { createClient } from "@/lib/supabase";
import { dosageInputSchemaFor } from "@/lib/validation/medication";

/**
 * Records the daily dosage — in force today, or scheduled from a later date. Its
 * own route because it writes `dosage_changes`, not a column on `medications` —
 * every mutation surface in this slice maps to the table it writes.
 *
 * **The body may now carry `effective_date`; the BOUND on it may not.** Until
 * S-05 no caller could send a date at all, and the reason was that the policy
 * compares `effective_date` against Postgres `current_date` while a caller's
 * date comes from their own zone. That reason has not gone away — it has moved
 * one level up. The date is now the user's to choose, but the floor it is
 * checked against is resolved here, server-side, in **UTC**, which is the zone
 * `current_date` speaks on Supabase. A floor taken from the request, or resolved
 * in the user's zone, would offer a day the database then refuses.
 *
 * Omitting the field still means "today, derived server-side", so every
 * pre-S-05 client keeps working unchanged.
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
  // A scheduled 0 is a scheduled stop, and equally legal.
  const parsed = dosageInputSchemaFor(resolveToday("UTC")).safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, "Check the highlighted fields", zodFieldErrors(parsed.error));
  }

  const result = await setDosage(
    supabase,
    id,
    parsed.data.daily_dosage,
    parsed.data.effective_date,
    resolveTodayForUser(context.locals.user.user_metadata),
  );
  if (!result.ok) {
    if (result.error === "not_found") {
      return jsonError(404, "Medication not found");
    }
    if (result.error === "date_not_allowed") {
      // The schema already floored this date, so getting here means either a
      // request that never went through the schema or the sub-second window
      // where the Worker and Postgres disagree about what day it is. A field
      // error is still the right shape: a retry is what fixes both.
      return jsonError(400, "Check the highlighted fields", {
        effective_date: "The effective date cannot be in the past",
      });
    }
    // The module restores the dosage it removed before reporting a failure, so
    // a 500 here honestly means nothing changed.
    return jsonError(500, "Could not save the dosage");
  }
  return json(result.data);
};
