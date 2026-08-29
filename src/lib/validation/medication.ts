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
const dailyDosageField = z
  .number({ error: "Enter the daily dosage as a number" })
  .min(0, "Daily dosage cannot be negative")
  .max(MAX_DAILY_DOSAGE, `Daily dosage must be ${MAX_DAILY_DOSAGE} or less`);

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

/** Recording the current daily dosage, including 0. */
export const dosageInputSchema = z.strictObject({
  daily_dosage: dailyDosageField,
});

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
export type DosageInput = z.infer<typeof dosageInputSchema>;
export type SupplyInput = z.infer<typeof supplyInputSchema>;
export type MedicationCreateInput = z.infer<typeof medicationCreateSchema>;
