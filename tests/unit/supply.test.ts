import { describe, expect, it } from "vitest";
import { classifySupplyStatus, computeSupply, doseInForce } from "@/lib/supply";

// Every expected value below is derived by hand from the breakpoint-walk
// algorithm's stated rules, independently of running computeSupply — never
// captured from what the function currently returns. An expectation lifted
// from the implementation passes by construction and can never fail for the
// right reason, which is exactly the failure mode this suite exists to rule
// out for the arithmetic the PRD calls a product failure if wrong.

const FAR_EXPIRY = "2027-01-01";

describe("computeSupply — worked examples", () => {
  it("projects a single refill against a constant dose to the day the ledger runs out", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }],
      dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-06",
    });
    expect(result).toEqual({ supplyEndDate: "2026-09-30", supplyEndReason: "consumption", projectedQuantity: 25 });
  });

  it("carries a second refill past the point a last-event-only anchor would have answered", () => {
    // A naive "anchor on the most recent event" implementation would answer
    // 2026-11-09 (30 days from the second refill) instead of accounting for
    // the 20 units still on hand when it arrived.
    const result = computeSupply({
      events: [
        { quantity_delta: 30, occurred_on: "2026-09-01" },
        { quantity_delta: 30, occurred_on: "2026-09-11" },
      ],
      dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-06",
    });
    expect(result.supplyEndDate).toBe("2026-10-30");
  });

  it("switches dose mid-walk at the change's own effective date", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }],
      dosages: [
        { daily_dosage: 1, effective_date: "2026-09-01" },
        { daily_dosage: 2, effective_date: "2026-09-11" },
      ],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-06",
    });
    expect(result.supplyEndDate).toBe("2026-09-20");
  });

  it("caps supply-end at expiry when consumption would otherwise run past it", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 100, occurred_on: "2026-09-01" }],
      dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }],
      expiryDate: "2026-10-01",
      today: "2026-09-06",
    });
    expect(result).toEqual({ supplyEndDate: "2026-10-01", supplyEndReason: "expiry", projectedQuantity: 95 });
  });

  it("bounds the breakpoint set at max(today, expiryDate), so a dosage change effective after expiry cannot push the walk past the cap — this is the one failure mode that OVER-reports cover", () => {
    // Without the <= bound filter, the 2026-09-20 dosage row would survive
    // into the breakpoint set, the 2026-09-15 span would run to 2026-09-19,
    // and the following span would have negative length — every other engine
    // defect found during S-04 under-reported; this is the one that would
    // tell a user they have cover they do not have.
    const result = computeSupply({
      events: [{ quantity_delta: 100, occurred_on: "2026-09-01" }],
      dosages: [
        { daily_dosage: 1, effective_date: "2026-09-01" },
        { daily_dosage: 3, effective_date: "2026-09-20" },
      ],
      expiryDate: "2026-09-15",
      today: "2026-09-06",
    });
    expect(result).toEqual({ supplyEndDate: "2026-09-15", supplyEndReason: "expiry", projectedQuantity: 95 });
  });

  it("continues the walk past an exhaustion, because a later refill un-ends it — returning early would report 'out of stock' to a user holding a nearly full box", () => {
    // Reachable from the ordinary UI: occurred_on is always today-in-UTC, so
    // "ran out, refilled a fortnight later" is not a hypothetical shape.
    const result = computeSupply({
      events: [
        { quantity_delta: 30, occurred_on: "2026-09-01" },
        { quantity_delta: 30, occurred_on: "2026-10-15" },
      ],
      dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }],
      expiryDate: FAR_EXPIRY,
      today: "2026-10-20",
    });
    expect(result).toEqual({ supplyEndDate: "2026-11-13", supplyEndReason: "consumption", projectedQuantity: 25 });
  });
});

describe("computeSupply — edges", () => {
  it("reports a null supply-end date only when nothing has ever been on hand — distinct from 'ran out', which yields a real past date", () => {
    const result = computeSupply({ events: [], dosages: [], expiryDate: FAR_EXPIRY, today: "2026-09-06" });
    expect(result).toEqual({ supplyEndDate: null, supplyEndReason: null, projectedQuantity: 0 });
  });

  it("treats no dosage rows as dose zero — stock stays intact and supply-end is the expiry, not a consumption date", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }],
      dosages: [],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-06",
    });
    expect(result).toEqual({ supplyEndDate: FAR_EXPIRY, supplyEndReason: "expiry", projectedQuantity: 30 });
  });

  it("treats a 5 -> 0 -> 5 series as three spans with zero consumption in the middle, never a gap to skip — the zero-dose branch must never divide", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 50, occurred_on: "2026-09-01" }],
      dosages: [
        { daily_dosage: 5, effective_date: "2026-09-01" },
        { daily_dosage: 0, effective_date: "2026-09-11" },
        { daily_dosage: 5, effective_date: "2026-09-21" },
      ],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-06",
    });
    expect(result.supplyEndDate).toBe("2026-09-10");
  });

  it("reports a zero projection when today precedes the first event — today is filtered out of the breakpoint set entirely, so it is never visited", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 30, occurred_on: "2026-09-07" }],
      dosages: [{ daily_dosage: 1, effective_date: "2026-09-07" }],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-06",
    });
    expect(result.projectedQuantity).toBe(0);
  });

  it("returns before the walk when expiry precedes every event, since nothing that arrived could ever have been usable", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }],
      dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }],
      expiryDate: "2026-01-01",
      today: "2026-09-06",
    });
    expect(result).toEqual({ supplyEndDate: "2026-01-01", supplyEndReason: "expiry", projectedQuantity: 0 });
  });

  it("still reaches today for the projection when expiry is already in the past", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 100, occurred_on: "2026-09-01" }],
      dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }],
      expiryDate: "2026-09-15",
      today: "2026-09-30",
    });
    expect(result).toEqual({ supplyEndDate: "2026-09-15", supplyEndReason: "expiry", projectedQuantity: 71 });
  });

  it("resolves an exhaustion landing exactly on the bound to 'consumption', not 'expiry' — a regression here leaves the date correct and only the reason wrong, which is invisible without this assertion", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }],
      dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }],
      expiryDate: "2026-09-30",
      today: "2026-09-06",
    });
    expect(result).toEqual({ supplyEndDate: "2026-09-30", supplyEndReason: "consumption", projectedQuantity: 25 });
  });

  it("handles a fractional dose consuming a fractional supply exactly", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 0.9, occurred_on: "2026-09-01" }],
      dosages: [{ daily_dosage: 0.3, effective_date: "2026-09-01" }],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-01",
    });
    expect(result.supplyEndDate).toBe("2026-09-03");
  });
});

describe("computeSupply — S-05 future-dated dosage shapes", () => {
  it("advances the dose exactly at its own future effective date, not from today — a scheduled increase", () => {
    // Seven days at 1/day (09-10 through 09-16) leaves 23. From 09-17 at
    // 3/day, floor(23 / 3) = 7 whole days covered, landing the last full
    // dose on 09-17 + 6 = 09-23. A prior deferred-test spec stated
    // 2026-09-24 here — an off-by-one that miscounted the final offset after
    // correctly deriving the day count. Do not copy that value.
    const result = computeSupply({
      events: [{ quantity_delta: 30, occurred_on: "2026-09-10" }],
      dosages: [
        { daily_dosage: 1, effective_date: "2026-09-10" },
        { daily_dosage: 3, effective_date: "2026-09-17" },
      ],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-10",
    });
    expect(result).toEqual({ supplyEndDate: "2026-09-23", supplyEndReason: "consumption", projectedQuantity: 30 });
  });

  it("extends the supply-end date for a scheduled DECREASE — a test covering only an increase would pass with a mis-signed comparison", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 30, occurred_on: "2026-09-10" }],
      dosages: [
        { daily_dosage: 1, effective_date: "2026-09-10" },
        { daily_dosage: 0.5, effective_date: "2026-09-17" },
      ],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-10",
    });
    expect(result.supplyEndDate).toBe("2026-11-01");
  });

  it("treats a scheduled stop (daily_dosage 0) as supply-end becoming the expiry, distinct from running out", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 30, occurred_on: "2026-09-10" }],
      dosages: [
        { daily_dosage: 1, effective_date: "2026-09-10" },
        { daily_dosage: 0, effective_date: "2026-09-17" },
      ],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-10",
    });
    expect(result).toEqual({ supplyEndDate: FAR_EXPIRY, supplyEndReason: "expiry", projectedQuantity: 30 });
  });

  it("composes two pending changes across three segments — the middle segment is the one a 'find the next change' implementation quietly drops", () => {
    const result = computeSupply({
      events: [{ quantity_delta: 30, occurred_on: "2026-09-10" }],
      dosages: [
        { daily_dosage: 1, effective_date: "2026-09-10" },
        { daily_dosage: 3, effective_date: "2026-09-17" },
        { daily_dosage: 1, effective_date: "2026-09-24" },
      ],
      expiryDate: FAR_EXPIRY,
      today: "2026-09-10",
    });
    expect(result).toEqual({ supplyEndDate: "2026-09-25", supplyEndReason: "consumption", projectedQuantity: 30 });
  });
});

describe("doseInForce", () => {
  it("returns 0 when no row has an effective_date on or before the queried date", () => {
    expect(doseInForce([{ daily_dosage: 2, effective_date: "2026-09-17" }], "2026-09-10")).toBe(0);
  });

  it("returns the greatest effective_date not after the queried date", () => {
    const dosages = [
      { daily_dosage: 1, effective_date: "2026-09-01" },
      { daily_dosage: 2, effective_date: "2026-09-10" },
      { daily_dosage: 3, effective_date: "2026-09-20" },
    ];
    expect(doseInForce(dosages, "2026-09-15")).toBe(2);
  });

  it("excludes a row dated one day ahead of the queried date — the exact shape the UTC/user-zone classification pairing defect produces", () => {
    // If a row is written at UTC-today but classified against a user-zone
    // "today" that has not yet rolled over, the row is one day in the
    // future relative to the classification date and doseInForce correctly
    // (if surprisingly, from the writer's perspective) excludes it.
    expect(doseInForce([{ daily_dosage: 2, effective_date: "2026-09-11" }], "2026-09-10")).toBe(0);
  });

  it("does not require the rows to be pre-sorted", () => {
    const dosages = [
      { daily_dosage: 3, effective_date: "2026-09-20" },
      { daily_dosage: 1, effective_date: "2026-09-01" },
      { daily_dosage: 2, effective_date: "2026-09-10" },
    ];
    expect(doseInForce(dosages, "2026-09-15")).toBe(2);
  });
});

describe("classifySupplyStatus", () => {
  it("partitions the full boundary in one block, so the shape is visible as a whole", () => {
    const visit = "2026-09-20";
    expect(classifySupplyStatus("2026-09-19", visit)).toBe("red");
    expect(classifySupplyStatus("2026-09-20", visit)).toBe("red");
    expect(classifySupplyStatus("2026-09-21", visit)).toBe("yellow");
    expect(classifySupplyStatus("2026-10-04", visit)).toBe("yellow");
    expect(classifySupplyStatus("2026-10-05", visit)).toBe("green");
  });

  it("colours a supply ending EXACTLY on the visit date red, not yellow — the bands partition on days of cover AFTER the visit, and this one has none: the day after the visit it is at zero, and the visit was the last chance to prevent that", () => {
    expect(classifySupplyStatus("2026-09-20", "2026-09-20")).toBe("red");
  });

  it("returns no_visit when there is no next visit, even over a null supply-end date", () => {
    expect(classifySupplyStatus(null, null)).toBe("no_visit");
  });

  it("returns red for a null supply-end date when a visit exists — nothing has ever been on hand, so there is no cover at all", () => {
    expect(classifySupplyStatus(null, "2026-09-20")).toBe("red");
  });
});
