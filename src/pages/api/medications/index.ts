import type { APIRoute } from "astro";
import { json, jsonError, readJsonBody, zodFieldErrors } from "@/lib/api/json";
import { createMedication, listMedications } from "@/lib/db/medications";
import { createClient } from "@/lib/supabase";
import { medicationCreateSchema } from "@/lib/validation/medication";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonError(401, "Sign in to continue");
  }
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "Supabase is not configured");
  }

  // Archived rows come back too — the island owns the "Show archived" toggle,
  // so the filtering decision is not the route's to make.
  const result = await listMedications(supabase);
  if (!result.ok) {
    return jsonError(500, "Could not load medications");
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

  // The schema is strict, so a body carrying `form` or any liquid column is
  // rejected here rather than stripped — S-06 owns that sub-type, and silently
  // dropping the field would let a caller believe it had created something this
  // slice cannot display.
  const parsed = medicationCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, "Check the highlighted fields", zodFieldErrors(parsed.error));
  }

  // Only the parsed output is forwarded — never `body.data`. See the update
  // payload rule in `@/lib/db/medications`; the route is the other place that
  // rule can be broken.
  const result = await createMedication(supabase, parsed.data);
  if (!result.ok) {
    if (result.error === "no_specialist") {
      // 400 with a field error, not 409: the reference is unresolvable and the
      // value came from a `<select>`, so the island renders it under that
      // control exactly as a zod failure would. `CLAUDE.md` → _API conventions_
      // reserves 409 for a delete blocked by children pointing at the row.
      return jsonError(400, "Check the highlighted fields", {
        specialist_id: "Choose a specialist you have added",
      });
    }
    return jsonError(500, "Could not save the medication");
  }
  return json(result.data, 201);
};
