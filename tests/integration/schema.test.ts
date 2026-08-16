import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/database.types";
import { createAuthenticatedClient, type TestClient } from "./helpers/client";

// These tests exercise the schema through PostgREST — the exact path the
// application takes. pgTAP (`npm run db:test`) proves the same invariants
// against the database directly; this suite is what catches a policy that
// targets the wrong role, or a constraint PostgREST manages to route around.

type MedicationInsert = Database["public"]["Tables"]["medications"]["Insert"];

/** SQLSTATE 23514 — check_violation. */
const CHECK_VIOLATION = "23514";
/** SQLSTATE 42501 — insufficient_privilege, i.e. an RLS policy refused the row. */
const RLS_VIOLATION = "42501";

interface Fixture {
  client: TestClient;
  userId: string;
  specialistId: string;
  medicationId: string;
}

/** Fails the fixture loudly rather than letting a null row surface as a confusing assertion later. */
function required<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new Error(`Fixture setup returned no ${what}`);
  }
  return value;
}

async function seedUser(label: string): Promise<Fixture> {
  const { client, userId } = await createAuthenticatedClient(label);

  // user_id is omitted everywhere on purpose: it defaults to auth.uid(), which
  // is what makes the RLS policies a uniform `auth.uid() = user_id`.
  const { data: specialist, error: specialistError } = await client
    .from("specialists")
    .insert({ name: `Dr ${label}`, specialty: "cardiology" })
    .select()
    .single();
  expect(specialistError).toBeNull();
  const specialistId = required(specialist, "specialist").id;

  const { data: medication, error: medicationError } = await client
    .from("medications")
    .insert({
      specialist_id: specialistId,
      name: `Med ${label}`,
      expiry_date: "2027-01-01",
    })
    .select()
    .single();
  expect(medicationError).toBeNull();

  return { client, userId, specialistId, medicationId: required(medication, "medication").id };
}

let alice: Fixture;
let bob: Fixture;

beforeAll(async () => {
  alice = await seedUser("alice");
  bob = await seedUser("bob");
});

describe("RLS isolation through PostgREST", () => {
  it("shows each user only their own specialists", async () => {
    const { data: aliceRows } = await alice.client.from("specialists").select("id");
    const { data: bobRows } = await bob.client.from("specialists").select("id");

    expect(aliceRows?.map((row) => row.id)).toEqual([alice.specialistId]);
    expect(bobRows?.map((row) => row.id)).toEqual([bob.specialistId]);
  });

  it("shows each user only their own medications", async () => {
    const { data: aliceRows } = await alice.client.from("medications").select("id");
    const { data: bobRows } = await bob.client.from("medications").select("id");

    expect(aliceRows?.map((row) => row.id)).toEqual([alice.medicationId]);
    expect(bobRows?.map((row) => row.id)).toEqual([bob.medicationId]);
  });

  it("returns zero rows — not an error carrying data — when one user asks for another's row by id", async () => {
    const { data, error } = await bob.client.from("medications").select("*").eq("id", alice.medicationId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("refuses an insert carrying another user's user_id", async () => {
    const { error } = await alice.client
      .from("specialists")
      .insert({ user_id: bob.userId, name: "Smuggled", specialty: "oncology" });

    expect(error?.code).toBe(RLS_VIOLATION);
  });
});

describe("append-only policies", () => {
  it("leaves a medication in place when a delete is attempted (FR-007: archival only)", async () => {
    // With no DELETE policy, RLS makes the statement match zero rows rather
    // than raise — so the assertion is that the row SURVIVES, not that an
    // error came back.
    const { error } = await alice.client.from("medications").delete().eq("id", alice.medicationId);
    expect(error).toBeNull();

    const { data } = await alice.client.from("medications").select("id").eq("id", alice.medicationId);
    expect(data).toEqual([{ id: alice.medicationId }]);
  });

  it("archives a medication instead", async () => {
    const { error } = await alice.client
      .from("medications")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", alice.medicationId);
    expect(error).toBeNull();

    const { data } = await alice.client.from("medications").select("archived_at").eq("id", alice.medicationId).single();
    expect(data?.archived_at).not.toBeNull();

    // leave the fixture usable for the ledger tests below
    await alice.client.from("medications").update({ archived_at: null }).eq("id", alice.medicationId);
  });
});

describe("supply ledger recount arithmetic", () => {
  it("accepts a refill and rejects a non-positive one", async () => {
    const { error: accepted } = await alice.client.from("supply_events").insert({
      medication_id: alice.medicationId,
      event_type: "refill",
      quantity_delta: 30,
      occurred_on: "2026-08-01",
    });
    expect(accepted).toBeNull();

    const { error: rejected } = await alice.client.from("supply_events").insert({
      medication_id: alice.medicationId,
      event_type: "refill",
      quantity_delta: 0,
      occurred_on: "2026-08-01",
    });
    expect(rejected?.code).toBe(CHECK_VIOLATION);
  });

  it("stores the discrepancy in quantity_delta on a recount", async () => {
    const { data, error } = await alice.client
      .from("supply_events")
      .insert({
        medication_id: alice.medicationId,
        event_type: "recount",
        counted_quantity: 25,
        projected_quantity: 28,
        quantity_delta: -3,
        occurred_on: "2026-08-02",
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(Number(data?.quantity_delta)).toBe(-3);
  });

  it("stores quantity_delta = 0 when the count matches the projection", async () => {
    const { data, error } = await alice.client
      .from("supply_events")
      .insert({
        medication_id: alice.medicationId,
        event_type: "recount",
        counted_quantity: 28,
        projected_quantity: 28,
        quantity_delta: 0,
        occurred_on: "2026-08-03",
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(Number(data?.quantity_delta)).toBe(0);
  });

  it("rejects a recount whose delta contradicts its counts, rather than silently correcting it", async () => {
    const { error } = await alice.client.from("supply_events").insert({
      medication_id: alice.medicationId,
      event_type: "recount",
      counted_quantity: 25,
      projected_quantity: 28,
      quantity_delta: 0,
      occurred_on: "2026-08-04",
    });

    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("rejects a non-recount event carrying counted_quantity", async () => {
    const { error } = await alice.client.from("supply_events").insert({
      medication_id: alice.medicationId,
      event_type: "adjustment",
      quantity_delta: -1,
      counted_quantity: 25,
      occurred_on: "2026-08-05",
    });

    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});

describe("liquid sub-type on medications", () => {
  it("creates a liquid medication in a single insert", async () => {
    const { data, error } = await alice.client
      .from("medications")
      .insert({
        specialist_id: alice.specialistId,
        name: "Syrup",
        form: "liquid",
        expiry_date: "2027-06-01",
        container_capacity: 200,
        estimated_daily_consumption: 15,
        post_opening_expiry_days: 30,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.form).toBe("liquid");
    // not yet opened — NULL opened_on is legal on a liquid
    expect(data?.opened_on).toBeNull();
  });

  it("rejects a liquid medication missing its liquid fields", async () => {
    const { error } = await alice.client.from("medications").insert({
      specialist_id: alice.specialistId,
      name: "Incomplete syrup",
      form: "liquid",
      expiry_date: "2027-06-01",
      container_capacity: 200,
    });

    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("rejects a solid medication carrying even one liquid field", async () => {
    const { error } = await alice.client.from("medications").insert({
      specialist_id: alice.specialistId,
      name: "Confused tablet",
      form: "solid",
      expiry_date: "2027-06-01",
      container_capacity: 200,
    });

    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});

describe("generated types", () => {
  it("makes an invalid column name a compile error", () => {
    const valid: MedicationInsert = {
      specialist_id: alice.specialistId,
      name: "Typed",
      expiry_date: "2027-01-01",
    };
    expect(valid.name).toBe("Typed");

    const invalid: MedicationInsert = {
      specialist_id: alice.specialistId,
      name: "Untyped",
      expiry_date: "2027-01-01",
      // @ts-expect-error - quantity lives only in supply_events; there is no cached column on medications.
      quantity_on_hand: 10,
    };
    expect(invalid.name).toBe("Untyped");
  });
});
