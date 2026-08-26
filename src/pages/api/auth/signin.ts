import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  // `formData()` rejects on an absent, truncated, or non-form body. Without this
  // guard a non-form POST yields a raw 500 instead of the redirect-with-message
  // pattern every other failure path in this route uses.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Invalid form submission")}`);
  }

  // `FormData.get` returns `string | File | null`, so these are narrowed rather
  // than cast — a POST omitting a field would otherwise pass `null` into
  // `signInWithPassword`.
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string") {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Email and password are required")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  // `/dashboard` is the documented post-auth destination (`CLAUDE.md` → _Auth &
  // route protection_). This used to redirect to `/`, which dropped the user on
  // the signed-out landing page instead of into the app.
  return context.redirect("/dashboard");
};
