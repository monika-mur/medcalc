import type { APIRoute } from "astro";
import { json, jsonError, readJsonBody, zodFieldErrors } from "@/lib/api/json";
import { recordSupply } from "@/lib/db/medications";
import { createClient } from "@/lib/supabase";
import { supplyInputSchema } from "@/lib/validation/medication";
import { readId } from "../_shared";

/**
 * Records a refill or a count correction. Its own route because it writes
 * `supply_events`; the ledger is append-only, so both intents are inserts and
 * neither is an UPDATE.
 *
 * A correction that resolves to a zero delta is a **successful no-op**, not a
 * 400 — the user is simply already at the figure they counted. The module
 * answers it with the unchanged row, which reaches the island as a plain 200.
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

  const parsed = supplyInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(400, "Check the highlighted fields", zodFieldErrors(parsed.error));
  }

  const result = await recordSupply(supabase, id, parsed.data);
  if (!result.ok) {
    if (result.error === "not_found") {
      return jsonError(404, "Medication not found");
    }
    return jsonError(500, "Could not record the supply change");
  }
  return json(result.data);
};
