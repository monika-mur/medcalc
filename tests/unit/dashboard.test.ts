import { describe, expect, it } from "vitest";
import type { MedicationView } from "@/lib/db/medications";
import { buildDashboard, nextVisitFor } from "@/lib/dashboard";
import type { Visit } from "@/lib/db/visits";

// buildDashboard reads only a handful of MedicationView's ~20 fields, but the
// type demands all of them, so a fixture builder fills in inert defaults and
// lets each test override only what it cares about.
function medication(
  overrides: Partial<MedicationView> & { id: string; specialist: MedicationView["specialist"] },
): MedicationView {
  return {
    archived_at: null,
    container_capacity: null,
    created_at: "2026-01-01T00:00:00Z",
    estimated_daily_consumption: null,
    expiry_date: "2027-01-01",
    form: "solid",
    name: "Test Medication",
    opened_on: null,
    post_opening_expiry_days: null,
    specialist_id: overrides.specialist.id,
    updated_at: "2026-01-01T00:00:00Z",
    user_id: "user-1",
    current_dosage: 1,
    quantity_on_hand: 30,
    supply_end_date: "2026-09-30",
    supply_end_reason: "consumption",
    projected_quantity: 20,
    status: "active",
    is_expired: false,
    pending_dosage_changes: [],
    ...overrides,
  };
}

function visit(overrides: Partial<Visit> & { id: string; specialist_id: string; visit_date: string }): Visit {
  return {
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    user_id: "user-1",
    ...overrides,
  };
}

const DR_A = { id: "specialist-a", name: "Dr Adamski", specialty: "cardiology" };
const DR_B = { id: "specialist-b", name: "Dr Baran", specialty: "endocrinology" };

describe("nextVisitFor", () => {
  it("returns the soonest visit that is not past for the given specialist", () => {
    const visits = [
      visit({ id: "v1", specialist_id: DR_A.id, visit_date: "2026-09-01" }),
      visit({ id: "v2", specialist_id: DR_A.id, visit_date: "2026-09-20" }),
      visit({ id: "v3", specialist_id: DR_A.id, visit_date: "2026-10-15" }),
    ];
    expect(nextVisitFor(visits, DR_A.id, "2026-09-10")).toBe("2026-09-20");
  });

  it("treats a visit dated today as next, not past — matching what /visits renders as Upcoming", () => {
    const visits = [visit({ id: "v1", specialist_id: DR_A.id, visit_date: "2026-09-10" })];
    expect(nextVisitFor(visits, DR_A.id, "2026-09-10")).toBe("2026-09-10");
  });

  it("returns null when the specialist has no upcoming visit", () => {
    const visits = [visit({ id: "v1", specialist_id: DR_A.id, visit_date: "2026-08-01" })];
    expect(nextVisitFor(visits, DR_A.id, "2026-09-10")).toBeNull();
  });

  it("ignores visits belonging to a different specialist", () => {
    const visits = [visit({ id: "v1", specialist_id: DR_B.id, visit_date: "2026-09-20" })];
    expect(nextVisitFor(visits, DR_A.id, "2026-09-10")).toBeNull();
  });
});

describe("buildDashboard — grouping and ordering", () => {
  it("orders specialist groups by next visit date ascending", () => {
    const meds = [medication({ id: "m1", specialist: DR_A }), medication({ id: "m2", specialist: DR_B })];
    const visits = [
      visit({ id: "v1", specialist_id: DR_A.id, visit_date: "2026-09-20" }),
      visit({ id: "v2", specialist_id: DR_B.id, visit_date: "2026-09-10" }),
    ];
    const groups = buildDashboard(meds, visits, "2026-09-01");
    expect(groups.map((g) => g.specialist.id)).toEqual([DR_B.id, DR_A.id]);
  });

  it("sorts a specialist with no visit scheduled LAST, rather than dropping the group — FR-009's 'no visit scheduled' is a state to show, not an absence to hide", () => {
    const meds = [medication({ id: "m1", specialist: DR_A }), medication({ id: "m2", specialist: DR_B })];
    const visits = [visit({ id: "v1", specialist_id: DR_A.id, visit_date: "2026-09-20" })];
    const groups = buildDashboard(meds, visits, "2026-09-01");
    expect(groups.map((g) => g.specialist.id)).toEqual([DR_A.id, DR_B.id]);
    expect(groups[1].nextVisitDate).toBeNull();
  });

  it("breaks a tie in next-visit date by specialist name", () => {
    const meds = [medication({ id: "m1", specialist: DR_B }), medication({ id: "m2", specialist: DR_A })];
    const visits = [
      visit({ id: "v1", specialist_id: DR_A.id, visit_date: "2026-09-20" }),
      visit({ id: "v2", specialist_id: DR_B.id, visit_date: "2026-09-20" }),
    ];
    const groups = buildDashboard(meds, visits, "2026-09-01");
    expect(groups.map((g) => g.specialist.id)).toEqual([DR_A.id, DR_B.id]);
  });

  it("excludes an archived medication entirely, including from a group header it would otherwise have created", () => {
    const meds = [medication({ id: "m1", specialist: DR_A, archived_at: "2026-08-01T00:00:00Z" })];
    const groups = buildDashboard(meds, [], "2026-09-01");
    expect(groups).toHaveLength(0);
  });

  it("orders cards within a group by state precedence: no_dosage above out_of_stock above red above yellow above green above no_visit above stopped", () => {
    const meds = [
      medication({ id: "m1", specialist: DR_A, name: "Green Med", status: "active", supply_end_date: "2026-11-01" }),
      medication({ id: "m2", specialist: DR_A, name: "NoDosage Med", status: "no_dosage" }),
      medication({ id: "m3", specialist: DR_A, name: "Stopped Med", status: "not_used" }),
      medication({ id: "m4", specialist: DR_A, name: "OutOfStock Med", status: "out_of_stock", supply_end_date: null }),
      medication({ id: "m5", specialist: DR_A, name: "Red Med", status: "active", supply_end_date: "2026-09-05" }),
    ];
    const visits = [visit({ id: "v1", specialist_id: DR_A.id, visit_date: "2026-09-20" })];
    const groups = buildDashboard(meds, visits, "2026-09-01");
    expect(groups[0].cards.map((c) => c.state)).toEqual(["no_dosage", "out_of_stock", "red", "green", "stopped"]);
  });

  it("breaks a tie in card state precedence by medication name", () => {
    const meds = [
      medication({ id: "m1", specialist: DR_A, name: "Zebra", status: "no_dosage" }),
      medication({ id: "m2", specialist: DR_A, name: "Apple", status: "no_dosage" }),
    ];
    const groups = buildDashboard(meds, [], "2026-09-01");
    expect(groups[0].cards.map((c) => c.medication.name)).toEqual(["Apple", "Zebra"]);
  });
});

describe("buildDashboard — card state mapping", () => {
  it("maps no_dosage straight through, short-circuiting the supply comparison", () => {
    const meds = [medication({ id: "m1", specialist: DR_A, status: "no_dosage" })];
    const groups = buildDashboard(meds, [], "2026-09-01");
    expect(groups[0].cards[0].state).toBe("no_dosage");
  });

  it("maps not_used to 'stopped', not to a supply-status colour — a stopped medication consumes nothing regardless of the date", () => {
    const meds = [medication({ id: "m1", specialist: DR_A, status: "not_used", supply_end_date: "2026-01-01" })];
    const groups = buildDashboard(meds, [], "2026-09-01");
    expect(groups[0].cards[0].state).toBe("stopped");
  });

  it("maps out_of_stock straight through", () => {
    const meds = [medication({ id: "m1", specialist: DR_A, status: "out_of_stock" })];
    const groups = buildDashboard(meds, [], "2026-09-01");
    expect(groups[0].cards[0].state).toBe("out_of_stock");
  });

  it("maps not_started to the SUPPLY-STATUS classification, deliberately joining 'active' rather than getting a quiet 'stopped' card — a quiet card would throw away a real supplyEndDate and could read as false reassurance", () => {
    const meds = [
      medication({
        id: "m1",
        specialist: DR_A,
        status: "not_started",
        supply_end_date: "2026-09-05",
        pending_dosage_changes: [{ daily_dosage: 2, effective_date: "2026-09-08" }],
      }),
    ];
    const visits = [visit({ id: "v1", specialist_id: DR_A.id, visit_date: "2026-09-20" })];
    const groups = buildDashboard(meds, visits, "2026-09-01");
    // supplyEndDate (09-05) is before the visit (09-20) -> red, exactly the
    // "you have enough" over-report a quiet 'stopped' state would have hidden.
    expect(groups[0].cards[0].state).toBe("red");
  });

  it("maps active to the supply-status classification", () => {
    const meds = [medication({ id: "m1", specialist: DR_A, status: "active", supply_end_date: "2026-11-01" })];
    const visits = [visit({ id: "v1", specialist_id: DR_A.id, visit_date: "2026-09-20" })];
    const groups = buildDashboard(meds, visits, "2026-09-01");
    expect(groups[0].cards[0].state).toBe("green");
  });

  it("classifies as no_visit when the specialist has nothing scheduled, even for an otherwise-active medication", () => {
    const meds = [medication({ id: "m1", specialist: DR_A, status: "active", supply_end_date: "2026-11-01" })];
    const groups = buildDashboard(meds, [], "2026-09-01");
    expect(groups[0].cards[0].state).toBe("no_visit");
  });
});
