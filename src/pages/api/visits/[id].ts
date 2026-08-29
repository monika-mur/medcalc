import type { APIRoute } from "astro";
import { z } from "zod";
import { json, jsonError, noContent, readJsonBody, zodFieldErrors } from "@/lib/api/json";
import { deleteVisit, updateVisit } from "@/lib/db/visits";
import { createClient } from "@/lib/supabase";
import { visitInputSchema } from "@/lib/validation/visit";

const idSchema = z.uuid();

/**
 * A non-UUID segment would reach Postgres as `22P02 invalid input syntax` and
 * surface as a 500. It is the same outcome as a UUID that matches nothing —
 * there is no such visit — so it is answered the same way.
 */
function readId(params: Record<string, string | undefined>): string | null {
  const parsed = idSchema.safeParse(params.id);
  return parsed.success ? parsed.data : null;
}

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
    return jsonError(404, "Visit not found");
  }

  const body = await readJsonBody(context.request);
  if (!body.ok) {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = visitInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, "Check the highlighted fields", zodFieldErrors(parsed.error));
  }

  // `parsed.data` carries only `specialist_id` and `visit_date` — an
  // `updated_at` sent in the body is dropped here and the module stamps its
  // own. No database constraint can reach that half of the rule.
  const result = await updateVisit(supabase, id, parsed.data);
  if (!result.ok) {
    if (result.error === "not_found") {
      return jsonError(404, "Visit not found");
    }
    if (result.error === "invalid_specialist") {
      return jsonError(400, "Check the highlighted fields", { specialist_id: "Choose a specialist from your list" });
    }
    return jsonError(500, "Could not save the visit");
  }
  return json(result.data);
};

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
    return jsonError(404, "Visit not found");
  }

  // Nothing references a visit, so there is no 409 branch here.
  const result = await deleteVisit(supabase, id);
  if (!result.ok) {
    if (result.error === "not_found") {
      return jsonError(404, "Visit not found");
    }
    return jsonError(500, "Could not delete the visit");
  }
  return noContent();
};
