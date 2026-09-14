import { describe, expect, it } from "vitest";
import { addExact, clampScale, floorDivide, multiplyExact, subtractExact } from "@/lib/decimal";

// Every assertion here names a float pair, not an operation — the point is the
// binary-floating-point failure class each helper exists to prevent, and a test
// using only whole numbers would pass against the exact defects these guard.

describe("floorDivide", () => {
  it("answers 3 for 0.9 / 0.3, where raw division gives 2.9999999999999996 and a naive floor lands one day short on the green/yellow boundary", () => {
    expect(floorDivide(0.9, 0.3)).toBe(3);
  });

  it("throws RangeError rather than returning Infinity when the divisor rounds to zero at the active scale", () => {
    expect(() => floorDivide(10, 4e-7)).toThrow(RangeError);
  });

  it("throws RangeError rather than returning NaN when the dividend is also zero", () => {
    expect(() => floorDivide(0, 4e-7)).toThrow(RangeError);
  });

  it("does not throw at 5e-7, the smallest divisor that still rounds to a nonzero integer at the 10^6 scale", () => {
    expect(() => floorDivide(10, 5e-7)).not.toThrow();
  });
});

describe("subtractExact", () => {
  it("answers exactly 0.2 for 0.3 - 0.1, where raw subtraction gives 0.19999999999999998", () => {
    expect(subtractExact(0.3, 0.1)).toBe(0.2);
  });

  it("scales to the wider of the two operands when their precisions differ", () => {
    expect(subtractExact(1.005, 0.9)).toBe(0.105);
  });
});

describe("addExact", () => {
  it("answers exactly 0.3 for 0.1 + 0.2, where raw addition gives 0.30000000000000004 — the running-ledger accumulation the walk depends on", () => {
    expect(addExact(0.1, 0.2)).toBe(0.3);
  });

  it("accumulates a ledger of fractional refills without drifting", () => {
    const total = [0.1, 0.2, 0.3].reduce((sum, delta) => addExact(sum, delta), 0);
    expect(total).toBe(0.6);
  });
});

describe("multiplyExact", () => {
  it("answers exactly 0.9 for 0.3 times 3 whole days, where raw multiplication gives 0.8999999999999999", () => {
    expect(multiplyExact(0.3, 3)).toBe(0.9);
  });

  it("scales only the fractional operand — the day count is already a whole number and needs no scaling", () => {
    expect(multiplyExact(1.5, 10)).toBe(15);
  });
});

describe("clampScale", () => {
  it("rounds to the module's six-place limit, matching what a value must look like before it is written", () => {
    expect(clampScale(0.1234567)).toBe(0.123457);
  });

  it("leaves a value already within six places untouched", () => {
    expect(clampScale(0.25)).toBe(0.25);
  });
});
