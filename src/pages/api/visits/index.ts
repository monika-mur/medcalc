import type { APIRoute } from "astro";
import { json, jsonError, readJsonBody, zodFieldErrors } from "@/lib/api/json";
import { createVisit, listVisits } from "@/lib/db/visits";
import { createClient } from "@/lib/supabase";
import { visitInputSchema } from "@/lib/validation/visit";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonError(401, "Sign in to continue");
  }
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "Supabase is not configured");
  }

  const result = await listVisits(supabase);
  if (!result.ok) {
    return jsonError(500, "Could not load visits");
  }
  return json(result.data);
};

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonError(401, "Sign in to continue");
  }
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "Supabase is not configured");
  }

  const body = await readJsonBody(context.request);
  if (!body.ok) {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = visitInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, "Check the highlighted fields", zodFieldErrors(parsed.error));
  }

  // Only the parsed output is forwarded — never `body.data`. See the update
  // payload rule in `@/lib/db/visits`; the route is the other place that rule
  // can be broken.
  const result = await createVisit(supabase, parsed.data);
  if (!result.ok) {
    // A specialist that is not this user's fails the composite FK. That is a
    // bad value in a form field, so it renders under the select exactly as a
    // zod failure would — not a 409, which here would mean nothing.
    if (result.error === "invalid_specialist") {
      return jsonError(400, "Check the highlighted fields", { specialist_id: "Choose a specialist from your list" });
    }
    return jsonError(500, "Could not save the visit");
  }
  return json(result.data, 201);
};
