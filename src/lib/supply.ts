import { addDays, daysBetween } from "@/lib/dates";
import { addExact, floorDivide, multiplyExact, subtractExact } from "@/lib/decimal";

/**
 * The supply calculation, as one chronological walk.
 *
 * This is the arithmetic the PRD guards hardest — "an incorrect 'you have
 * enough' result is a product failure regardless of how smooth the rest of the
 * experience is" — and it is deliberately the ONLY implementation of it. F-01
 * declined to put it in SQL (`20260813185255_domain_schema.sql:155-158`)
 * because a second copy is a second thing to get wrong, so there is no view and
 * no database function behind this file.
 *
 * There is no consumption event type: `supply_events` records what was added
 * and corrected, never what was taken. Consumption is therefore *projected* by
 * walking the ledger forward against the dosage series, which is why the raw
 * `Σ quantity_delta` is not the quantity on hand and never was.
 *
 * Every date here is a `YYYY-MM-DD` string compared as a string, so no `Date`
 * object appears anywhere on this path — see `src/lib/dates.ts`.
 *
 * Written so S-05's future-dated dosage rows are simply more breakpoints: the
 * walk needs no change to accommodate them.
 */

export interface SupplyInputs {
  events: { quantity_delta: number; occurred_on: string }[];
  dosages: { daily_dosage: number; effective_date: string }[];
  expiryDate: string;
  today: string;
}

export interface SupplyResult {
  /** Last day a full dose is available. `null` only when no supply event exists. */
  supplyEndDate: string | null;
  /** Which constraint produced the date. Ties resolve to `"consumption"`. */
  supplyEndReason: "consumption" | "expiry" | null;
  /** On hand on the morning of `today`, before that day's dose. Never negative. */
  projectedQuantity: number;
}

interface DosageRow {
  daily_dosage: number;
  effective_date: string;
}

/**
 * The dosage in force on `at`: the greatest `effective_date` that is not after
 * it. No row at all reads as 0 — a legal state, not missing data.
 *
 * Exported because `MedicationView.current_dosage` is the same question asked
 * about today, and answering it twice is how the list and the dashboard end up
 * disagreeing about one row.
 */
export function doseInForce(dosages: DosageRow[], at: string): number {
  let current: DosageRow | null = null;
  for (const row of dosages) {
    if (row.effective_date > at) continue;
    if (!current || row.effective_date > current.effective_date) {
      current = row;
    }
  }
  return current ? current.daily_dosage : 0;
}

export function computeSupply(inputs: SupplyInputs): SupplyResult {
  const { events, dosages, expiryDate, today } = inputs;

  // Nothing has ever been on hand, so there is nothing to consume and no date
  // to report. Distinct from "ran out", which yields a real past date.
  if (events.length === 0) {
    return { supplyEndDate: null, supplyEndReason: null, projectedQuantity: 0 };
  }

  let start = events[0].occurred_on;
  for (const event of events) {
    if (event.occurred_on < start) {
      start = event.occurred_on;
    }
  }

  // Expiry precedes every event: nothing that arrived can ever have been
  // usable. Returned up front because `expiryDate` would otherwise be filtered
  // out of the breakpoint set by the `>= start` bound, taking the cap with it.
  if (expiryDate < start) {
    return { supplyEndDate: expiryDate, supplyEndReason: "expiry", projectedQuantity: 0 };
  }

  // The last date the walk has any reason to reach. Supply-end is capped at
  // expiry regardless, and the projection is read off `today`, so nothing past
  // the later of the two can change either answer.
  const bound = today > expiryDate ? today : expiryDate;

  // `expiryDate` is a breakpoint so that no span straddles the cap, and `today`
  // is one so the projection can be read off mid-walk even on a day when
  // nothing else happens. Everything past `bound` is dropped: a future
  // `effective_date` (S-05 writes those) or an `occurred_on` a day ahead
  // through the UTC skew would otherwise leave a span running past expiry and a
  // following span of negative length.
  const breakpoints = [
    ...new Set([
      ...events.map((event) => event.occurred_on),
      ...dosages.map((dosage) => dosage.effective_date),
      today,
      expiryDate,
    ]),
  ]
    .filter((date) => date >= start && date <= bound)
    .sort();

  let remaining = 0;
  let projectedQuantity = 0;
  let supplyEndDate: string | null = null;
  // Exhaustion is provisional: a later refill un-ends it. See the re-arm below.
  let exhausted = false;

  for (let index = 0; index < breakpoints.length; index += 1) {
    const at = breakpoints[index];

    for (const event of events) {
      if (event.occurred_on === at) {
        remaining = addExact(remaining, event.quantity_delta);
      }
    }
    // A correction cannot leave less than nothing on the shelf. Unreachable
    // through the recount path, whose delta is bounded by its own projection.
    if (remaining < 0) {
      remaining = 0;
    }

    // The re-arm. `occurred_on` is always today-in-UTC, so "ran out, refilled a
    // fortnight later" is an ordinary shape rather than an edge case, and a
    // walk that returned at the first exhaustion would report that stale date
    // for a user holding a full box. `exhausted` implies `remaining` was 0
    // before the deltas above, so a positive balance here means new supply
    // arrived.
    if (exhausted && remaining > 0) {
      exhausted = false;
      supplyEndDate = null;
    }

    if (at === today) {
      projectedQuantity = remaining;
    }

    // Nothing to consume, and consuming anyway would only re-record a later
    // exhaustion date for a supply that already ended.
    if (exhausted) {
      continue;
    }

    const spanEnd = index + 1 < breakpoints.length ? addDays(breakpoints[index + 1], -1) : bound;
    const spanLength = daysBetween(at, spanEnd) + 1;
    const dose = doseInForce(dosages, at);

    // Never divide by the dose. `daily_dosage = 0` is the schema's first-class
    // "I have stopped taking this", so a 5 -> 0 -> 5 series is three spans with
    // no consumption in the middle — not a gap to skip.
    if (dose === 0) {
      if (remaining === 0) {
        // No full dose to be had on any day of this span, so supply ended the
        // day before it started.
        supplyEndDate = addDays(at, -1);
        exhausted = true;
      }
      continue;
    }

    const covered = floorDivide(remaining, dose);
    if (covered >= spanLength) {
      remaining = subtractExact(remaining, multiplyExact(dose, spanLength));
    } else {
      // `covered === 0` yields the day before `at`, the same shape as the
      // zero-dose exhaustion above.
      supplyEndDate = addDays(at, covered - 1);
      remaining = 0;
      exhausted = true;
    }
  }

  // Running out exactly at `bound` is exhaustion, not survival: the final span
  // was fully covered, so the last full dose falls on `bound` itself. Without
  // this the walk ends unexhausted and the cap below reports `"expiry"` for a
  // supply that consumption ended on the very same day — and when `bound` is
  // `today` rather than `expiryDate`, it would report a date the user has
  // already reached as though it were still ahead of them.
  if (!exhausted && remaining === 0) {
    supplyEndDate = bound;
    exhausted = true;
  }

  // The cap, applied once. Not an exit test inside the walk: the walk has to
  // reach `today` to report a projection even when expiry is long past, so
  // expiry bounds where it stops but never why. A supply that outlives `bound`
  // is capped here; one that ends after an expiry already in the past is
  // clamped back to it; and an exhaustion landing exactly on `expiryDate` stays
  // `"consumption"`, because ties resolve that way.
  if (!exhausted || supplyEndDate === null || supplyEndDate > expiryDate) {
    return { supplyEndDate: expiryDate, supplyEndReason: "expiry", projectedQuantity };
  }
  return { supplyEndDate, supplyEndReason: "consumption", projectedQuantity };
}

export type SupplyStatus = "green" | "yellow" | "red" | "no_visit";

/**
 * The PRD's colour scale, as a partition on **days of cover after the visit**:
 * green is more than 14, yellow is 1 through 14, red is none.
 *
 * That is what puts `supplyEnd === visit` in red. Every medication in the
 * yellow band has some cover left after the appointment; this one has none —
 * the day after the visit it is at zero, and the visit is the last chance to
 * prevent that. It also makes yellow exactly 14 days wide rather than 15 with a
 * ragged edge. `prd.md` reads "on or before" for the red boundary; do not
 * "correct" this to a strict `<`.
 *
 * Green's boundary is untouched: `visit + 14` is yellow, `visit + 15` is green.
 */
export function classifySupplyStatus(supplyEndDate: string | null, nextVisitDate: string | null): SupplyStatus {
  if (nextVisitDate === null) {
    return "no_visit";
  }
  // Nothing has ever been on hand, so there is no cover at all.
  if (supplyEndDate === null) {
    return "red";
  }
  if (supplyEndDate <= nextVisitDate) {
    return "red";
  }
  return supplyEndDate > addDays(nextVisitDate, 14) ? "green" : "yellow";
}
