import type { APIRoute } from "astro";
import { json, jsonError } from "@/lib/api/json";
import { readDateParam, readId } from "@/lib/api/params";
import { resolveTodayForUser } from "@/lib/dates";
import { cancelDosageChange } from "@/lib/db/medications";
import { createClient } from "@/lib/supabase";

/**
 * Cancels one dosage change, addressed by the date it takes effect. A `DELETE`
 * on the thing being removed rather than a POST carrying an intent, because
 * `dosage_changes` has no UPDATE policy: cancel-and-reschedule is the entire
 * vocabulary for correcting a scheduled change, so cancel earns its own verb.
 *
 * **This route also accepts TODAY's date, and removes the dosage in force.**
 * That is deliberate, not an oversight, and it follows from the policy rather
 * than from a decision taken here: `dosage_changes_delete_uncommitted_own`
 * admits `effective_date >= current_date`, so today's row is removable right up
 * until the day turns. It is the one path by which the application — as opposed
 * to Studio — can produce a medication whose dosage has not started yet, and
 * `POST /dosage` puts the row back whenever the user wants it. Do not add a
 * floor. The panel does not offer it because it lists pending changes only;
 * that is a UI decision, and this is the API.
 *
 * Returns the refreshed `MedicationView` rather than 204, for the same reason
 * the dosage POST does: the island applies the recalculated row in place, and a
 * 204 would force it to refetch the figure it just changed.
 */
export const DELETE: APIRoute = async (context) => {
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

  // A malformed segment is a 404, not a 400 — the reasoning lives with the
  // parser in `@/lib/api/params`, alongside `readId`'s. No floor here either;
  // see the header.
  const date = readDateParam(context.params);
  if (!date) {
    return jsonError(404, "Scheduled change not found");
  }

  const result = await cancelDosageChange(supabase, id, date, resolveTodayForUser(context.locals.user.user_metadata));
  if (!result.ok) {
    if (result.error === "not_found") {
      // Covers all three zero-row cases the policy produces and does not
      // distinguish them: no such row, someone else's row, or a row that has
      // already taken effect. Saying which would answer a question the caller
      // has not proved it may ask.
      return jsonError(404, "Scheduled change not found");
    }
    return jsonError(500, "Could not cancel the scheduled change");
  }
  return json(result.data);
};
