import type { APIRoute } from "astro";
import { z } from "zod";
import { json, jsonError, readJsonBody } from "@/lib/api/json";
import { setArchived } from "@/lib/db/medications";
import { createClient } from "@/lib/supabase";
import { readId } from "../_shared";

/**
 * Archive (FR-007) and its undo. A separate route rather than a boolean inside
 * `medicationDetailsSchema`, so a details edit does not have to resend archival
 * state and `zodFieldErrors` keeps mapping one message onto one form field.
 *
 * The schema is declared here rather than in `@/lib/validation/medication`
 * because there is no form field for it to guard: the island sends this from a
 * button, so there is nothing for a client-side parse to render a message under
 * and no client/server pair that could drift. `strictObject` still refuses any
 * extra key, so an `archived_at` of the caller's choosing cannot ride along.
 */
const archiveInputSchema = z.strictObject({
  archived: z.boolean({ error: "`archived` must be true or false" }),
});

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

  const parsed = archiveInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, "Request body must be `{ archived: boolean }`");
  }

  // The timestamp is the module's to set. `archived` is an intent, not a value.
  const result = await setArchived(supabase, id, parsed.data.archived);
  if (!result.ok) {
    if (result.error === "not_found") {
      return jsonError(404, "Medication not found");
    }
    return jsonError(500, "Could not update the medication");
  }
  return json(result.data);
};
