import { describe, expect, it } from "vitest";
import { discrepancyPhrase } from "@/lib/notices";

// The correction notice is the ONE place in the product where arithmetic over
// two `numeric`-sourced values is visible to the user. The row the server wrote
// was always exact; what shipped once was a notice reading
// "0.19999999999999998 fewer than projected", because the island recomputed the
// difference with a raw `-` instead of `subtractExact`.
//
// Every case below is a float pair that raw JS gets wrong. The point of each
// assertion is the float class, not the sentence — a test that only used whole
// numbers would pass against the exact defect this file exists to prevent.

describe("the correction notice's discrepancy phrase", () => {
  it("renders a fractional shortfall as 0.2, not 0.19999999999999998 — raw JS subtraction is what shipped the original defect", () => {
    expect(discrepancyPhrase(0.3, 0.1)).toBe(" — 0.2 fewer than projected");
  });

  it("renders a fractional surplus as 0.2 as well, so the two directions cannot drift apart", () => {
    expect(discrepancyPhrase(0.1, 0.3)).toBe(" — 0.2 more than projected");
  });

  it("keeps three-decimal precision exactly (1.005 → 0.9 is 0.105, which raw subtraction also gets wrong)", () => {
    expect(discrepancyPhrase(1.005, 0.9)).toBe(" — 0.105 fewer than projected");
  });

  it("states a whole-number difference without a decimal tail", () => {
    expect(discrepancyPhrase(30, 18)).toBe(" — 12 fewer than projected");
  });

  it("carries a six-decimal clamped value through intact, the widest figure the scale can represent", () => {
    expect(discrepancyPhrase(5, 0.123457)).toBe(" — 4.876543 fewer than projected");
  });

  it("says nothing when the count matched the projection — there is no discrepancy to report", () => {
    expect(discrepancyPhrase(30, 30)).toBe("");
  });

  it("says nothing when no prior projection was held, rather than reporting the count as the difference", () => {
    expect(discrepancyPhrase(undefined, 18)).toBe("");
  });
});
