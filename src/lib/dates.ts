/**
 * One authoritative "today", and the classifications that read from it.
 *
 * Every value here is a `YYYY-MM-DD` string, which is simultaneously what
 * `<input type="date">` reads and writes, what Postgres uses on the wire for a
 * `date` column, and what `Intl.DateTimeFormat("en-CA")` produces. So every
 * comparison in this module is a plain string comparison and no timezone
 * conversion happens anywhere except inside `resolveToday`. Introducing a
 * `Date` object on this path is how an off-by-one-day bug gets in.
 */

function formatIn(timeZone: string | undefined, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The user's "today", resolved from their stored IANA zone.
 *
 * The zone is treated as hostile input even though `src/pages/api/auth/signup.ts`
 * validates it on write, because `auth.updateUser({ data })` can replace
 * `user_metadata` afterwards; an invalid zone throws `RangeError` at
 * construction, which would take down a whole page rather than one field.
 *
 * **UTC is the normal path, not a degraded one.** The zone is stamped only by
 * the inline script on the signup page, and signin never backfills it — so an
 * account created with JavaScript disabled, and every account that predates
 * that script, resolves through the fallback.
 *
 * Callers must narrow before calling: `user_metadata` is `Record<string, any>`,
 * and handing that `any` to a `string | undefined` parameter is exactly what
 * `@typescript-eslint/no-unsafe-argument` reports. The narrow is the same
 * hostile-input argument as the `try`/`catch`, applied one level earlier.
 *
 * Pass the literal `"UTC"` for a date a Postgres RLS policy compares against
 * `current_date` — see `CLAUDE.md` → _Dates_. The two "todays" may differ by a
 * calendar day, and that is intended.
 */
export function resolveToday(timeZone: string | undefined, now = new Date()): string {
  try {
    return formatIn(timeZone, now);
  } catch {
    return formatIn("UTC", now);
  }
}

/** Strict `<`: a visit dated today is **not** past — it belongs in Upcoming. */
export function isPast(visitDate: string, today: string): boolean {
  return visitDate < today;
}

/**
 * More than two years after `today`, compared as strings against `today` with
 * its year field incremented by 2. A `today` of `2028-02-29` yields the bound
 * `2030-02-29`, which is not a real date — harmless here, because the bound is
 * only ever one side of a string comparison and sorts exactly where a reader
 * expects it to, between `2030-02-28` and `2030-03-01`.
 */
export function isFarFuture(visitDate: string, today: string): boolean {
  const bound = `${String(Number(today.slice(0, 4)) + 2)}${today.slice(4)}`;
  return visitDate > bound;
}
