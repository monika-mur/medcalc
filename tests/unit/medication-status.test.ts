import { describe, expect, it } from "vitest";
import { deriveStatus, nextNonzeroPendingChange } from "@/lib/db/medications";

describe("deriveStatus", () => {
  it("asserts all six precedence rows in one block, so the ordering is visible as a whole", () => {
    // archivedAt, dosageCount, hasNonzeroPending, currentDosage, projectedQuantity
    expect(deriveStatus(null, 0, false, 0, 0)).toBe("no_dosage");
    expect(deriveStatus(null, 1, true, 0, 0)).toBe("not_started");
    expect(deriveStatus(null, 1, false, 0, 0)).toBe("not_used");
    expect(deriveStatus(null, 1, false, 2, 0)).toBe("out_of_stock");
    expect(deriveStatus(null, 1, false, 2, 5)).toBe("active");
    expect(deriveStatus("2026-09-01", 1, false, 2, 5)).toBe("archived");
  });

  it("returns archived regardless of any other input — it is the user's explicit 'hide this' and wins over everything", () => {
    expect(deriveStatus("2026-09-01", 0, true, 0, 0)).toBe("archived");
  });

  it("distinguishes 'no dosage rows at all' (no_dosage) from 'a dosage row present with value 0' (not_used) — collapsing them would let a failed insert read as the user's own choice, so the test is the row count, never the value", () => {
    expect(deriveStatus(null, 0, false, 0, 100)).toBe("no_dosage");
    expect(deriveStatus(null, 1, false, 0, 100)).toBe("not_used");
  });

  it("fires not_started on currentDosage 0 plus a nonzero pending row — not on 'every row is future-dated', which is a narrower and previously-shipped-wrong test", () => {
    // A medication created at 0/day today with a real dose scheduled next
    // week has ONE row in force (today, value 0) and one pending (nonzero).
    // dosageCount is 2, not "all future", and the status must still be
    // not_started rather than not_used.
    expect(deriveStatus(null, 2, true, 0, 0)).toBe("not_started");
  });

  it("stays not_used when a second pending row is ALSO zero — the pending row's VALUE gates the distinction, not merely its presence", () => {
    // A user re-confirming a stop (or a mis-click) schedules a second 0/day
    // row. That is still "zero and staying zero", so hasNonzeroPending must
    // be false here, and the status must read not_used, not not_started.
    expect(deriveStatus(null, 2, false, 0, 0)).toBe("not_used");
  });

  it("reads out_of_stock from a non-positive PROJECTED quantity, not the raw ledger sum — the ledger never decays, so testing it would report a medication refilled a year ago as still in stock", () => {
    expect(deriveStatus(null, 1, false, 2, 0)).toBe("out_of_stock");
    expect(deriveStatus(null, 1, false, 2, -0.5)).toBe("out_of_stock");
  });

  it("returns active only once dosage is in force and something remains", () => {
    expect(deriveStatus(null, 1, false, 2, 1)).toBe("active");
  });
});

describe("nextNonzeroPendingChange", () => {
  it("returns undefined for an empty pending list", () => {
    expect(nextNonzeroPendingChange([])).toBeUndefined();
  });

  it("returns undefined when every pending row is zero", () => {
    const pending = [
      { daily_dosage: 0, effective_date: "2026-09-17" },
      { daily_dosage: 0, effective_date: "2026-09-24" },
    ];
    expect(nextNonzeroPendingChange(pending)).toBeUndefined();
  });

  it("is deliberately NOT pending[0] — it skips a scheduled stop to find a later scheduled resume", () => {
    // A medication can carry a scheduled stop followed by a later scheduled
    // resume: the soonest pending row is 0/day, but a real dose is still
    // coming, and anything naming "when does the dosage begin" must agree.
    const pending = [
      { daily_dosage: 0, effective_date: "2026-09-17" },
      { daily_dosage: 3, effective_date: "2026-09-24" },
    ];
    expect(nextNonzeroPendingChange(pending)).toEqual({ daily_dosage: 3, effective_date: "2026-09-24" });
  });

  it("returns the first nonzero row when the first pending row is already nonzero", () => {
    const pending = [
      { daily_dosage: 2, effective_date: "2026-09-17" },
      { daily_dosage: 3, effective_date: "2026-09-24" },
    ];
    expect(nextNonzeroPendingChange(pending)).toEqual({ daily_dosage: 2, effective_date: "2026-09-17" });
  });
});
