import { z } from "zod";

/**
 * The single definition of a valid visit input, imported by both the island and
 * the API routes so client-side and server-side validation cannot drift apart —
 * the role `specialist.ts` plays for S-01.
 *
 * **Neither rule here has a database counterpart.** `visit_date` is an
 * unconstrained `date` column with no `CHECK`, and `specialist_id` is only
 * constrained by the composite FK — which rejects another user's specialist but
 * says nothing about the calendar. This schema is the only thing enforcing the
 * 1900–2100 bounds, and they are a typo guard rather than a domain rule: a
 * past-dated visit is valid and must parse (FR-009's Socratic note is answered
 * by S-04's dashboard, not by refusing to store the row).
 */
export const visitInputSchema = z.object({
  // The only way a user produces a bad value here is by not picking one.
  specialist_id: z.uuid({ error: "Choose a specialist" }),
  // `z.iso.date()` is leap-year aware: it accepts `2028-02-29` and rejects
  // `2027-02-29`, so a malformed or impossible date never reaches Postgres.
  visit_date: z.iso
    .date({ error: "Enter a visit date" })
    .refine((value) => value >= "1900-01-01" && value <= "2100-12-31", "Enter a date between 1900 and 2100"),
});

/** The parsed output — the only shape the data module accepts. */
export type VisitInput = z.infer<typeof visitInputSchema>;
