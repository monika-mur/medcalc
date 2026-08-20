import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

// `user_metadata` is embedded in the access token and is user-writable via
// `auth.updateUser({ data })`, so it is never trusted. Constructing a
// DateTimeFormat is the same call S-04 makes to render, so a zone that survives
// this check cannot throw RangeError on the dashboard path. It also rejects an
// oversized string, which would otherwise inflate every request header.
function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const POST: APIRoute = async (context) => {
  // `formData()` rejects on an absent, truncated, or non-form body. Without this
  // guard a non-form POST yields a raw 500 instead of the redirect-with-message
  // pattern every other failure path in this route uses.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Invalid form submission")}`);
  }

  // `FormData.get` returns `string | File | null`, so these are narrowed rather
  // than cast — a POST omitting a field would otherwise pass `null` into `signUp`.
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string") {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Email and password are required")}`);
  }

  // Stamped onto the form's hidden field at submit time by the inline script in
  // signup.astro. Empty when JavaScript is disabled — in that case no
  // `timezone` key is stored at all, rather than an empty string, and the
  // reader falls back downstream (S-04 owns the fallback). An invalid zone is
  // dropped the same way — no key rather than a bad key.
  const submittedRaw = form.get("timezone");
  const submitted = typeof submittedRaw === "string" ? submittedRaw.trim() : undefined;
  const timezone = submitted && isValidTimeZone(submitted) ? submitted : undefined;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signUp({
    email,
    password,
    ...(timezone ? { options: { data: { timezone } } } : {}),
  });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/auth/confirm-email");
};
