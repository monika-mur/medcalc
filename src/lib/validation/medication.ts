import { z } from "zod";

/**
 * The four input shapes this slice accepts, each imported by both the island
 * and its route so client-side and server-side validation cannot drift apart —
 * the rule S-01 set in `@/lib/validation/specialist`.
 *
 * Every bound mirrors a database CHECK where one exists, and supplies a bound
 * where the column has none. `daily_dosage` and `quantity_delta` are unbounded
 * `numeric` in Postgres — F-01 follow-up F2 (numeric scale) is still queued —
 * so these schemas are currently the ONLY guard against an absurd magnitude
 * reaching the ledger. They bound magnitude, not decimal places: half a tablet
 * is a real dosage, and rounding is F2's question, not this slice's.
 *
 * Three of the four are constants; the dosage shape is a **factory**, because
 * one of its bounds is the server's own today. See `dosageInputSchemaFor`.
 *
 * Every object is strict. A body carrying `form` or any of the four liquid
 * columns (`container_capacity`, `estimated_daily_consumption`,
 * `post_opening_expiry_days`, `opened_on`) is REJECTED, not stripped: S-06 owns
 * the liquid sub-type, and silently dropping `form: "liquid"` would let an API
 * caller believe it had created something this slice cannot display. Rejecting
 * here also keeps `medications_liquid_fields_match_form` from ever being the
 * thing that reports the mistake.
 */

/**
 * Magnitude ceilings. Both are deliberately generous — they exist to stop a
 * typo or a hostile caller writing a number that breaks the arithmetic S-04
 * builds on top of this ledger, not to express a clinical opinion.
 */
const MAX_DAILY_DOSAGE = 1000;
const MAX_QUANTITY = 100_000;

/**
 * Zero is valid and is NOT an error: it is how the user records "I have stopped
 * taking this", which the schema comment at
 * `20260813185255_domain_schema.sql:126-129` calls out as a legal, meaningful
 * state distinct from archival. Only negatives are refused, mirroring
 * `dosage_changes_daily_dosage_non_negative`.
 */
/**
 * The smallest non-zero dosage the supply engine can divide by.
 *
 * `@/lib/decimal` scales operands by `10^6`, so a divisor below `5e-7` rounds to
 * **zero** and `floorDivide` answers `Infinity` (the walk then never decrements
 * and reports "lasts until expiry" — the over-report the PRD calls a product
 * failure) or `NaN` (which reaches `addDays` and renders as the literal string
 * `"0NaN-NaN-NaN"`). Magnitude bounds alone do not prevent this: `0.0000004`
 * satisfies `min(0).max(1000)`.
 *
 * The floor is the module's own scale rather than a clinical opinion — a
 * millionth of a unit per day is already far past anything dispensable, and the
 * engine cannot represent smaller. Zero stays legal: it is the schema's
 * first-class "I have stopped taking this" and is a distinct branch in the walk
 * that never divides.
 */
const MIN_NONZERO_DOSAGE = 0.000001;

const dailyDosageField = z
  .number({ error: "Enter the daily dosage as a number" })
  .min(0, "Daily dosage cannot be negative")
  .max(MAX_DAILY_DOSAGE, `Daily dosage must be ${MAX_DAILY_DOSAGE} or less`)
  .refine((value) => value === 0 || value >= MIN_NONZERO_DOSAGE, {
    error: `A non-zero daily dosage must be ${MIN_NONZERO_DOSAGE} or more`,
  });

/**
 * A starting or corrected quantity. Zero is legal here too — a user who has
 * finished a pack and has no new one is at 0, which the list labels rather than
 * warns about.
 */
const quantityField = z
  .number({ error: "Enter the quantity as a number" })
  .min(0, "Quantity cannot be negative")
  .max(MAX_QUANTITY, `Quantity must be ${MAX_QUANTITY} or less`);

/** The medication's own columns — everything an edit may change. */
export const medicationDetailsSchema = z.strictObject({
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(120, "Name must be 120 characters or fewer"),
  specialist_id: z.uuid({ error: "Choose a specialist" }),
  // `expiry_date` is the date printed on the box, so the user supplies it.
  // Contrast `effective_date` and `occurred_on`, which the data module derives
  // in UTC and no caller may send — see `@/lib/db/medications`.
  expiry_date: z.iso.date({ error: "Enter the expiry date as YYYY-MM-DD" }),
});

/**
 * Recording the daily dosage — from today, or from a later date.
 *
 * **A factory rather than a constant, and the reason is the bound.**
 * `effective_date` is the first date in this codebase that a *client* chooses
 * for a *policy-compared* column. `expiry_date` above is client-chosen but
 * compared against nothing; `occurred_on` is policy-compared but derived
 * server-side and no caller may send it. This one is both, so its floor depends
 * on the server's today and cannot be written down ahead of time.
 *
 * That floor must be resolved in **UTC**, never in the user's zone:
 * `dosage_changes_insert_own` compares against Postgres `current_date`, which is
 * UTC on Supabase, so a bound taken from the visitor's clock would offer a day
 * the policy then refuses — the exact shape of the bug
 * `20260829071323`'s header describes. See `CLAUDE.md` → _Dates_ and
 * `@/lib/db/medications` → `todayUtc`.
 *
 * Omitting the field keeps meaning "today, derived server-side". That is what
 * leaves every pre-S-05 caller correct.
 *
 * The comparison is a string comparison, because `YYYY-MM-DD` sorts
 * lexicographically and introducing a `Date` here is how this path acquires an
 * off-by-one-day bug. It is a `refine` and not `.min()` on purpose: `z.iso.date()`
 * is a `ZodString` underneath, so `.min()` would bound the string's *length*.
 */
export function dosageInputSchemaFor(todayUtc: string) {
  return z.strictObject({
    daily_dosage: dailyDosageField,
    effective_date: z.iso
      .date({ error: "Enter the effective date as YYYY-MM-DD" })
      .refine((value) => value >= todayUtc, { error: "The effective date cannot be in the past" })
      .optional(),
  });
}

/**
 * Recording supply. A refill adds; a correction states the counted total and
 * lets the module work out the adjustment. Discriminated on `kind` so
 * `zodFieldErrors` still maps one message onto one form field.
 *
 * `amount` must be strictly positive, mirroring
 * `supply_events_refill_is_positive`. A correction to 0 is fine — that is the
 * user saying the pack is empty.
 */
export const supplyInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("refill"),
    amount: z
      .number({ error: "Enter the amount as a number" })
      .gt(0, "A refill must add more than 0")
      .max(MAX_QUANTITY, `Amount must be ${MAX_QUANTITY} or less`),
  }),
  z.strictObject({
    kind: z.literal("correction"),
    counted: quantityField,
  }),
]);

/** Creating a medication: its own columns plus the two opening ledger values. */
export const medicationCreateSchema = medicationDetailsSchema.extend({
  daily_dosage: dailyDosageField,
  quantity: quantityField,
});

export type MedicationDetailsInput = z.infer<typeof medicationDetailsSchema>;
export type DosageInput = z.infer<ReturnType<typeof dosageInputSchemaFor>>;
export type SupplyInput = z.infer<typeof supplyInputSchema>;
export type MedicationCreateInput = z.infer<typeof medicationCreateSchema>;
