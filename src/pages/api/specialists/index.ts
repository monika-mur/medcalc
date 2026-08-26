import type { APIRoute } from "astro";
import { json, jsonError, readJsonBody, zodFieldErrors } from "@/lib/api/json";
import { createSpecialist, listSpecialists } from "@/lib/db/specialists";
import { createClient } from "@/lib/supabase";
import { specialistInputSchema } from "@/lib/validation/specialist";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonError(401, "Sign in to continue");
  }
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "Supabase is not configured");
  }

  const result = await listSpecialists(supabase);
  if (!result.ok) {
    return jsonError(500, "Could not load specialists");
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

  const parsed = specialistInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, "Check the highlighted fields", zodFieldErrors(parsed.error));
  }

  // Only the parsed output is forwarded — never `body.data`. See the update
  // payload rule in `@/lib/db/specialists`; the route is the other place that
  // rule can be broken.
  const result = await createSpecialist(supabase, parsed.data);
  if (!result.ok) {
    return jsonError(500, "Could not save the specialist");
  }
  return json(result.data, 201);
};
