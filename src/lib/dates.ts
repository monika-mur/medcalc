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

/**
 * The narrow every caller of `resolveToday` needs, in one place.
 *
 * `user_metadata` is typed `Record<string, any>`, so reading a field off it
 * yields `any` and handing that to a `string | undefined` parameter is exactly
 * what `@typescript-eslint/no-unsafe-argument` reports. Nine call sites need
 * the same three lines; written out nine times, one of them eventually is not.
 */
export function resolveTodayForUser(userMetadata: unknown): string {
  const zone: unknown = (userMetadata as { timezone?: unknown } | null | undefined)?.timezone;
  return resolveToday(typeof zone === "string" ? zone : undefined);
}

/**
 * Day arithmetic, via an epoch-day integer and **never** via a `Date`.
 *
 * `new Date("2026-09-06")` parses as UTC midnight while `getDate()` reads in
 * the local zone, so the obvious implementation is off by one for half the
 * planet — the bug this module's header exists to prevent. The conversion below
 * is Howard Hinnant's civil-from-days / days-from-civil pair: pure integer
 * arithmetic over the proleptic Gregorian calendar, correct across month, year
 * and leap boundaries with no zone anywhere in it.
 */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Throws rather than returning a sentinel. Every caller in the supply path
 * passes either a value already gated by `z.iso.date()`, a `date` column
 * Postgres serialised, or a value `resolveToday` produced — so reaching this is
 * a programming error, not a runtime input path, and a silent `NaN` would
 * propagate into a supply-end date instead of stopping.
 */
function toEpochDay(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received ${JSON.stringify(date)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Rejects a well-formed string naming a day that does not exist (2026-02-30,
  // 2026-13-01). The round-trip below would otherwise silently normalise it.
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received ${JSON.stringify(date)}`);
  }

  const shiftedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  const epochDay = era * 146097 + dayOfEra - 719468;

  if (fromEpochDay(epochDay) !== date) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received ${JSON.stringify(date)}`);
  }
  return epochDay;
}

function fromEpochDay(epochDay: number): string {
  const shifted = epochDay + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `date` shifted by `days`, which may be negative. */
export function addDays(date: string, days: number): string {
  // The date argument is validated by `toEpochDay`; the offset was not, which
  // left the module's stated purpose half-served. A `NaN` offset — reachable
  // when a caller derives one from a division this module does not own — flows
  // through `fromEpochDay` and returns the string `"0NaN-NaN-NaN"`, which then
  // compares lexicographically against real dates and renders into a `<time>`
  // element. Same reasoning as `toEpochDay`: stop rather than propagate.
  if (!Number.isFinite(days)) {
    throw new RangeError(`Expected a finite day offset, received ${String(days)}`);
  }
  return fromEpochDay(toEpochDay(date) + days);
}

/** Signed `to − from`, in whole days. A `to` before `from` is negative. */
export function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}
