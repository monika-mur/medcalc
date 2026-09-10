/**
 * Exact decimal arithmetic over `number`, for the values that arrive from
 * Postgres `numeric` columns.
 *
 * `numeric` is exact decimal; JS `number` is binary floating point. The two
 * disagree in ways that land exactly on this slice's critical path:
 *
 * - `0.9 / 0.3` is `2.9999999999999996`, so a naive `Math.floor` answers 2
 *   where 3 is correct — a one-day error in the supply-end date, which is one
 *   day on the green/yellow boundary.
 * - `0.3 - 0.1` is `0.19999999999999998`. Postgres computes `0.2`, so a delta
 *   derived that way fails `supply_events_recount_delta_is_discrepancy` with
 *   `23514` and surfaces as an unexplained "Could not record the supply change".
 *
 * Every operation here scales both operands to integers, works in integers, and
 * scales back. Nothing in this module is a rounding *policy* — the six-place
 * limit exists because that is where a `number` stops round-tripping reliably,
 * not because six places mean anything to a medication count.
 */

/**
 * Beyond six places the shortest round-trip representation stops being a
 * reliable source of the author's intent, and `10 ** places` starts costing
 * precision of its own. A hostile caller sending thirteen decimal places is
 * clamped here rather than allowed to push the scale out.
 */
const MAX_SCALE = 6;
const MAX_FACTOR = 10 ** MAX_SCALE;

/**
 * Read off `String(n)`, which is the shortest representation that round-trips —
 * so `0.1` reports 1 place rather than the 55 its binary expansion has.
 *
 * Exponential notation (`1e-7`, `1e+21`) is treated as the clamp rather than
 * parsed: nothing in range produces it, since zod bounds both dosage and
 * quantity well inside the notation's thresholds.
 */
function decimalPlaces(n: number): number {
  const text = String(n);
  if (text.includes("e") || text.includes("E")) {
    return MAX_SCALE;
  }
  const point = text.indexOf(".");
  if (point === -1) {
    return 0;
  }
  return Math.min(text.length - point - 1, MAX_SCALE);
}

function factorFor(a: number, b: number): number {
  return 10 ** Math.min(Math.max(decimalPlaces(a), decimalPlaces(b)), MAX_SCALE);
}

/**
 * Exact `⌊a / b⌋`. Callers guarantee `b > 0` — the zero-dose case is a distinct
 * branch in the walk, never a division, per `CLAUDE.md` → _Domain schema_.
 */
export function floorDivide(a: number, b: number): number {
  const factor = factorFor(a, b);
  const scaledDivisor = Math.round(b * factor);
  // `b > 0` is not the guarantee this needs. Scaling caps at `10^6`, so any
  // `0 < b < 5e-7` rounds to a zero divisor and the division yields `Infinity`
  // (the walk then never decrements and over-reports cover to the expiry date)
  // or `NaN` (which reaches `addDays` and renders as `"0NaN-NaN-NaN"`). Both are
  // silent. Throwing here matches `toEpochDay` in `@/lib/dates`: a value this
  // module cannot represent is a programming error upstream, and stopping is
  // better than a plausible wrong number on the screen the PRD guards hardest.
  if (scaledDivisor === 0) {
    throw new RangeError(`floorDivide needs a divisor representable at ${String(factor)}, received ${String(b)}`);
  }
  return Math.floor(Math.round(a * factor) / scaledDivisor);
}

/** Exact `a − b`, to the wider of the two operands' scales. */
export function subtractExact(a: number, b: number): number {
  const factor = factorFor(a, b);
  return (Math.round(a * factor) - Math.round(b * factor)) / factor;
}

/** Exact `a + b`, to the wider of the two operands' scales. */
export function addExact(a: number, b: number): number {
  const factor = factorFor(a, b);
  return (Math.round(a * factor) + Math.round(b * factor)) / factor;
}

/**
 * Exact `a × times`, where `times` is a whole number of days. Scaling only `a`
 * keeps the intermediate product as small as the inputs allow: `remaining` is a
 * running ledger sum rather than one event, so the bound is
 * `MAX_QUANTITY × eventCount` and not `MAX_QUANTITY`. At `10^6` scaling that
 * leaves roughly 9×10⁴ maximum-size refills on a single medication before
 * `Number.MAX_SAFE_INTEGER` is in reach — unreachable at this product's volume,
 * but the ledger-sum reading is the honest one.
 */
export function multiplyExact(a: number, times: number): number {
  const factor = 10 ** decimalPlaces(a);
  return (Math.round(a * factor) * times) / factor;
}

/**
 * `n` rounded to the module's six-place limit.
 *
 * Exported because the clamp has to be applied to a value **before it is
 * written**, not only inside an operation. `counted_quantity` is `numeric` with
 * unbounded scale, so a value stored raw and a delta derived through
 * `subtractExact` disagree at the seventh decimal — and Postgres, comparing in
 * exact `numeric`, rejects the row. Storing the clamped value in both places
 * makes the three figures agree by construction.
 */
export function clampScale(n: number): number {
  return Math.round(n * MAX_FACTOR) / MAX_FACTOR;
}
