import type { ZodError } from "zod";

/**
 * The JSON contract every domain API route in this app answers with. Domain
 * routes are called by `fetch` from a hydrated island, so they return JSON;
 * auth routes are native form targets and redirect with `?error=` instead. See
 * `CLAUDE.md` → _API conventions_ for the rule that decides which.
 */
export interface ApiErrorBody {
  error: {
    message: string;
    /** Field name → the first message for that field. */
    fieldErrors?: Record<string, string>;
  };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonError(status: number, message: string, fieldErrors?: Record<string, string>): Response {
  const body: ApiErrorBody = { error: { message, ...(fieldErrors ? { fieldErrors } : {}) } };
  return json(body, status);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/**
 * `request.json()` rejects on an absent, truncated, or non-JSON body. Without
 * this guard such a request yields a raw 500 rather than a 400 in the contract's
 * shape — the same failure the `formData()` guard on the auth routes fixed for
 * impl-review F10.
 */
export async function readJsonBody(request: Request): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    return { ok: true, data: await request.json() };
  } catch {
    return { ok: false };
  }
}

/**
 * Flattens a `ZodError` into the `fieldErrors` map, keeping the first message
 * per field so a form renders one message under each input.
 */
export function zodFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.map(String).join(".");
    if (field && !(field in fieldErrors)) {
      fieldErrors[field] = issue.message;
    }
  }
  return fieldErrors;
}
