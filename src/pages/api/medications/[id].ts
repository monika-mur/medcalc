import type { APIRoute } from "astro";
import { json, jsonError, readJsonBody, zodFieldErrors } from "@/lib/api/json";
import { readId } from "@/lib/api/params";
import { updateMedicationDetails } from "@/lib/db/medications";
import { createClient } from "@/lib/supabase";
import { medicationDetailsSchema } from "@/lib/validation/medication";

/**
 * There is deliberately **no `DELETE` export**. FR-007 archives rather than
 * deletes, and `medications` carries no DELETE policy to back one — under RLS
 * such a request would match zero rows and report success while changing
 * nothing. Archival is `POST /api/medications/[id]/archive`.
 */
export const PATCH: APIRoute = async (context) => {
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

  const parsed = medicationDetailsSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, "Check the highlighted fields", zodFieldErrors(parsed.error));
  }

  // `parsed.data` carries only `name`, `specialist_id` and `expiry_date`. An
  // `updated_at` sent in the body is dropped here and the module stamps its
  // own; `archived_at` cannot be smuggled in through a details edit at all.
  const result = await updateMedicationDetails(supabase, id, parsed.data);
  if (!result.ok) {
    if (result.error === "not_found") {
      return jsonError(404, "Medication not found");
    }
    if (result.error === "no_specialist") {
      return jsonError(400, "Check the highlighted fields", {
        specialist_id: "Choose a specialist you have added",
      });
    }
    return jsonError(500, "Could not save the medication");
  }
  return json(result.data);
};
