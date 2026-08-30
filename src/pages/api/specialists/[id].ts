import type { APIRoute } from "astro";
import { json, jsonError, noContent, readJsonBody, zodFieldErrors } from "@/lib/api/json";
import { readId } from "@/lib/api/params";
import { deleteSpecialist, updateSpecialist } from "@/lib/db/specialists";
import { createClient } from "@/lib/supabase";
import { specialistInputSchema } from "@/lib/validation/specialist";

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
    return jsonError(404, "Specialist not found");
  }

  const body = await readJsonBody(context.request);
  if (!body.ok) {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = specialistInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, "Check the highlighted fields", zodFieldErrors(parsed.error));
  }

  // `parsed.data` carries only `name` and `specialty` — an `updated_at` sent in
  // the body is dropped here and the module stamps its own. This is the half of
  // impl-review F8 that no database constraint can reach.
  const result = await updateSpecialist(supabase, id, parsed.data);
  if (!result.ok) {
    if (result.error === "not_found") {
      return jsonError(404, "Specialist not found");
    }
    return jsonError(500, "Could not save the specialist");
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
    return jsonError(404, "Specialist not found");
  }

  const result = await deleteSpecialist(supabase, id);
  if (!result.ok) {
    if (result.error === "not_found") {
      return jsonError(404, "Specialist not found");
    }
    if (result.error === "still_referenced") {
      return jsonError(409, "This specialist still has medications or visits assigned");
    }
    return jsonError(500, "Could not delete the specialist");
  }
  return noContent();
};
