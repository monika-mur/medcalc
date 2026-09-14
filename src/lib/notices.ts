import { subtractExact } from "@/lib/decimal";

/**
 * User-facing notice fragments derived from domain numbers.
 *
 * Anything here operates on values that came out of `numeric` columns, so it
 * goes through `@/lib/decimal` rather than raw operators — the same rule the
 * data modules follow on the write path. This module exists so that rule is
 * checkable: a phrase built inside an island can only be tested by rendering
 * the island, and a pure function can be tested directly.
 */

/**
 * The trailing half of the correction notice, when the count differed from what
 * the app projected. This is the first time the user learns a projection was
 * being tracked at all, so it is stated in their terms — "2 fewer than
 * projected" — rather than as a signed delta.
 *
 * Computed from the projection the page held before the write rather than from
 * the `recount` row, which the response does not carry. The two agree: the
 * module derives its delta from the projection as of `occurred_on`, and the
 * only way they diverge is a UTC/user-zone day boundary crossing mid-request,
 * where a silent phrase is better than a wrong one.
 *
 * `subtractExact`, never `-`, for the same reason `recordSupply` uses it on the
 * write path: both figures come from `numeric` columns, and a raw JS
 * `0.3 - 0.1` renders as `0.19999999999999998`. The ledger is unaffected — the
 * delta stored in the row is computed server-side and is exact either way — but
 * the sentence the user reads is the one place that arithmetic is visible, so
 * getting it wrong here undermines the figure rather than the data.
 */
export function discrepancyPhrase(before: number | undefined, after: number): string {
  if (before === undefined || before === after) {
    return "";
  }
  const difference = Math.abs(subtractExact(after, before));
  return ` — ${String(difference)} ${after < before ? "fewer" : "more"} than projected`;
}
