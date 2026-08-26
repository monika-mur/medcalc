import { z } from "zod";

/**
 * The single definition of a valid specialist input, imported by both the
 * island and the API route so client-side and server-side validation cannot
 * drift apart.
 *
 * `min(1)` after `trim()` mirrors `specialists_name_not_blank` and
 * `specialists_specialty_not_blank`, so a value the database would reject is
 * refused before it reaches PostgREST. The 120-character cap has **no**
 * database counterpart — both columns are unbounded `text` — so this schema is
 * currently the only bound on their length.
 */
export const specialistInputSchema = z.object({
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(120, "Name must be 120 characters or fewer"),
  specialty: z
    .string({ error: "Specialty is required" })
    .trim()
    .min(1, "Specialty is required")
    .max(120, "Specialty must be 120 characters or fewer"),
});

/** The parsed, trimmed output — the only shape the data module accepts. */
export type SpecialistInput = z.infer<typeof specialistInputSchema>;
