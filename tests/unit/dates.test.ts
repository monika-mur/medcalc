import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isFarFuture, isPast, resolveToday } from "@/lib/dates";

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("crosses a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("accepts a negative offset and steps backward", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("crosses into 2024's leap day", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("does NOT treat 2100 as a leap year — divisible by 100 but not by 400", () => {
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01");
  });

  it("DOES treat 2000 as a leap year — divisible by 400", () => {
    expect(addDays("2000-02-28", 1)).toBe("2000-02-29");
  });

  it("throws RangeError on a well-formed but calendrically nonexistent day, caught by the round-trip check rather than the range check", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });

  it('throws RangeError on a NaN offset, rather than propagating the literal string "0NaN-NaN-NaN" into a rendered date', () => {
    expect(() => addDays("2026-09-10", Number.NaN)).toThrow(RangeError);
  });

  it("throws RangeError on a non-finite offset (Infinity)", () => {
    expect(() => addDays("2026-09-10", Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("still works with a finite negative offset once the NaN guard is in place", () => {
    expect(addDays("2026-09-10", -5)).toBe("2026-09-05");
  });

  it("matches the platform's own Date arithmetic over 5000 consecutive days — a differential check against a source this module does not itself depend on", () => {
    const base = Date.UTC(2020, 0, 1);
    let mismatches = 0;
    for (let i = 0; i < 5000; i += 1) {
      const expected = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
      if (addDays("2020-01-01", i) !== expected) {
        mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });
});

describe("daysBetween", () => {
  it("is signed: a 'to' before 'from' is negative", () => {
    expect(daysBetween("2026-09-10", "2026-09-01")).toBe(-9);
  });

  it("is zero for the same date", () => {
    expect(daysBetween("2026-09-10", "2026-09-10")).toBe(0);
  });

  it("crosses a year boundary correctly", () => {
    expect(daysBetween("2026-12-25", "2027-01-05")).toBe(11);
  });
});

describe("isPast", () => {
  it("is strict: a visit dated today is NOT past — it belongs in Upcoming, not history", () => {
    expect(isPast("2026-09-10", "2026-09-10")).toBe(false);
  });

  it("is true for a visit dated yesterday", () => {
    expect(isPast("2026-09-09", "2026-09-10")).toBe(true);
  });

  it("is false for a visit dated tomorrow", () => {
    expect(isPast("2026-09-11", "2026-09-10")).toBe(false);
  });
});

describe("isFarFuture", () => {
  it("is false for a visit exactly two years out", () => {
    expect(isFarFuture("2028-09-10", "2026-09-10")).toBe(false);
  });

  it("is true for a visit more than two years out", () => {
    expect(isFarFuture("2028-09-11", "2026-09-10")).toBe(true);
  });

  it("is false for a visit under the two-year bound", () => {
    expect(isFarFuture("2027-01-01", "2026-09-10")).toBe(false);
  });
});

describe("resolveToday", () => {
  it("formats an injected clock in the given IANA zone, never reading the real clock", () => {
    // 2026-09-10T02:00:00Z is still 2026-09-09 in America/New_York (UTC-4 in September).
    const fixed = new Date("2026-09-10T02:00:00Z");
    expect(resolveToday("America/New_York", fixed)).toBe("2026-09-09");
  });

  it("falls back to UTC on an invalid IANA zone instead of throwing — the fallback is the normal path for an unset zone, not a degraded one", () => {
    const fixed = new Date("2026-09-10T02:00:00Z");
    expect(() => resolveToday("Not/AZone", fixed)).not.toThrow();
    expect(resolveToday("Not/AZone", fixed)).toBe("2026-09-10");
  });

  it('resolves UTC directly when the zone is explicitly "UTC", matching the value a policy-compared column must use', () => {
    const fixed = new Date("2026-09-10T23:30:00Z");
    expect(resolveToday("UTC", fixed)).toBe("2026-09-10");
  });
});
