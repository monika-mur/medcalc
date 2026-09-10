import type { Tables } from "@/db/database.types";
import { resolveToday } from "@/lib/dates";
import { addExact, clampScale, subtractExact } from "@/lib/decimal";
import type { SupabaseClient } from "@/lib/supabase";
import { computeSupply, doseInForce } from "@/lib/supply";
import type { MedicationCreateInput, MedicationDetailsInput, SupplyInput } from "@/lib/validation/medication";

export type Medication = Tables<"medications">;

/**
 * Derived, in this precedence order. Archival wins because it is the user's
 * explicit "hide this"; a stopped medication is reported as stopped rather than
 * as empty, because the intent is the more informative fact.
 *
 * `no_dosage` and `not_used` are mutually exclusive, so their order documents
 * intent rather than resolving a clash. They are separate states because a
 * dosage of 0 means two different things: the user set it — the schema's
 * first-class "I have stopped taking this"
 * (`20260813185255_domain_schema.sql:126-129`) — or no `dosage_changes` row
 * exists at all, which folds to 0 as well. The second is reachable, because
 * `createMedication` logs a failed dosage insert and still reports success.
 * Collapsed into one label it reads as a deliberate choice while the app has in
 * fact lost the user's data, so the test is the row count, never the value.
 *
 * **Handed to S-05**: a medication whose dosage rows are all future-dated has a
 * non-zero count and folds to 0 today, so it lands in `not_used` / "Stopped".
 * No S-04 surface can write that row, so it is unreachable here — but S-05's
 * whole purpose is writing one, and "Stopped" is the wrong word for "starts
 * next Monday". S-05 splits it.
 */
export type MedicationStatus = "archived" | "no_dosage" | "not_used" | "out_of_stock" | "active";

/**
 * A medication plus the numbers that are NOT columns on it. Dosage lives only
 * in `dosage_changes` and quantity only in `supply_events` deltas
 * (`CLAUDE.md` -> _Domain schema_); the absence of a cached copy is what makes
 * drift impossible, so they are folded on read rather than stored.
 *
 * `quantity_on_hand` is the raw ledger sum and keeps that meaning — the create
 * and refill paths still reason in ledger terms. It is **not** what the user
 * has: there is no consumption event type, so the sum decays for nobody.
 * `projected_quantity` is the figure to display, and every read of "on hand" on
 * a screen means that one.
 *
 * `is_expired` is reported beside `status`, not folded into it: a medication
 * can be expired AND in any of the five states.
 */
export interface MedicationView extends Medication {
  specialist: { id: string; name: string; specialty: string };
  current_dosage: number;
  quantity_on_hand: number;
  supply_end_date: string | null;
  supply_end_reason: "consumption" | "expiry" | null;
  projected_quantity: number;
  status: MedicationStatus;
  is_expired: boolean;
}

/**
 * Why a call failed, in domain terms. Postgres codes and messages stop here.
 *
 * `no_specialist` is the composite-FK violation raised when `specialist_id`
 * names a specialist that does not exist or belongs to someone else. Routes
 * answer it **400 with `fieldErrors.specialist_id`**, not 409: `CLAUDE.md` ->
 * _API conventions_ reserves 409 for "blocked by references" — a delete refused
 * because children point at the row, which is `deleteSpecialist`'s case and the
 * opposite direction of travel. Here the reference is unresolvable, the value
 * came from a `<select>`, and a field error is the shape the island can act on.
 * S-03 maps the same violation the same way; do not "restore" this to 409.
 */
export type MedicationErrorKind = "not_found" | "no_specialist" | "unknown";

export type Result<T> = { ok: true; data: T } | { ok: false; error: MedicationErrorKind };

/** `foreign_key_violation` — raised by the composite `(x_id, user_id)` FKs. */
const FK_VIOLATION = "23503";

/**
 * Collapsing a Postgres error to a domain kind discards its code, message and
 * hint, and Workers observability (`wrangler.jsonc` -> `observability.enabled`)
 * is the only place a 500 on this path is visible at all. Log before
 * discarding. Expected domain outcomes — `no_specialist`, and the `not_found`
 * an unresolvable FK reports on a child insert — are not incidents and are
 * answered without a log line.
 */
function logDbError(operation: string, error: { code: string; message: string }): void {
  // eslint-disable-next-line no-console -- console is the Workers log sink; `no-console` is a repo preference, not a ban.
  console.error(`medications.${operation}`, { code: error.code, message: error.message });
}

/**
 * Today, in UTC, resolved on the server. Never in the browser, and never sent
 * by a caller.
 *
 * **Used for written dates only** — `effective_date` and `occurred_on`, plus
 * the projection stamped onto a `recount` row, which has to be as of the date
 * that row carries. Classification moved to the user's own zone in S-04 and
 * arrives as the `today` argument every exported function now takes; the two
 * may differ by a calendar day, which is the point.
 *
 * `dosage_changes_delete_uncommitted_own` compares `effective_date` against
 * Postgres `current_date`, which is UTC on Supabase. A date taken from the
 * visitor's clock disagrees with it for part of every day: at 22:00 in UTC-8 a
 * local "today" is yesterday in UTC, so the row just written already fails
 * `effective_date >= current_date` and the dosage cannot be corrected — exactly
 * the bug the Phase 1 migration exists to remove. `occurred_on` follows by
 * symmetry.
 *
 * This is column-scoped, not a blanket rule: a date resolved for user-facing
 * classification belongs in the user's own zone, and S-03 resolves one that way
 * for its Upcoming/Past split. The two "todays" may differ by a calendar day,
 * and that is intended. See `CLAUDE.md` -> _Dates_.
 *
 * Both branches go through the one resolver in `src/lib/dates.ts`: passing the
 * literal `"UTC"` here is what makes the zone an argument rather than a second
 * implementation, so "resolve a date through `resolveToday`" is a rule about
 * the code and not an aspiration.
 */
function todayUtc(): string {
  return resolveToday("UTC");
}

/**
 * Every embed the fold needs. `specialists` resolves through the composite FK
 * `(specialist_id, user_id)` without a disambiguating hint — the same thing
 * `listSpecialists` relies on in the other direction.
 */
const MEDICATION_SELECT =
  "*, specialists(id, name, specialty), dosage_changes(daily_dosage, effective_date), supply_events(quantity_delta, occurred_on)";

/**
 * No function here filters by `user_id`. RLS does that, and a redundant filter
 * would hide a policy regression from any test that looks for one.
 */

interface MedicationRow extends Medication {
  specialists: { id: string; name: string; specialty: string } | null;
  dosage_changes: { daily_dosage: number; effective_date: string }[];
  supply_events: { quantity_delta: number; occurred_on: string }[];
}

/**
 * `dosageCount` rather than `currentDosage === 0`, because those are different
 * questions — see `MedicationStatus`. Out-of-stock reads the **projected**
 * quantity: the ledger sum never decays, so testing it would report a
 * medication refilled a year ago at one a day as still in stock, which is the
 * "you have enough" over-report the PRD's guardrail forbids.
 */
function deriveStatus(
  archivedAt: string | null,
  dosageCount: number,
  currentDosage: number,
  projectedQuantity: number,
): MedicationStatus {
  if (archivedAt !== null) return "archived";
  if (dosageCount === 0) return "no_dosage";
  if (currentDosage === 0) return "not_used";
  if (projectedQuantity <= 0) return "out_of_stock";
  return "active";
}

/**
 * Folds one row against the supply engine. `today` is the **user's** date, not
 * UTC: this row replaces one the page rendered in the user's zone, and a
 * UTC-classified row landing in that list is how the two disagree about the
 * same medication.
 *
 * This used to be named the S-04 replacement point, on the assumption the
 * arithmetic would move into a Postgres view. It did not, and deliberately —
 * `src/lib/supply.ts` is the single implementation, for the reason F-01 gave
 * for not writing it in SQL in the first place.
 */
function toView(row: MedicationRow, today: string): MedicationView {
  const { specialists, dosage_changes, supply_events, ...medication } = row;

  const currentDosage = doseInForce(dosage_changes, today);
  // `addExact`, not `+`: these are `numeric` columns, and a ledger holding 0.3
  // and -0.1 sums to 0.19999999999999998 under raw float addition. Nothing
  // renders this figure today — Phase 1 moved every display to
  // `projected_quantity` — but it is public on `MedicationView` and serialised
  // into the API response, so the drift would be inherited by whoever reads it
  // next rather than introduced by them.
  const quantityOnHand = supply_events.reduce((sum, event) => addExact(sum, event.quantity_delta), 0);
  const supply = computeSupply({
    events: supply_events,
    dosages: dosage_changes,
    expiryDate: medication.expiry_date,
    today,
  });

  return {
    ...medication,
    // `specialist_id` is `not null` and the composite FK guarantees a visible
    // parent, so this fallback guards against a shape change in the embed, not
    // against a state the database permits.
    specialist: specialists ?? { id: medication.specialist_id, name: "Unknown specialist", specialty: "" },
    current_dosage: currentDosage,
    quantity_on_hand: quantityOnHand,
    supply_end_date: supply.supplyEndDate,
    supply_end_reason: supply.supplyEndReason,
    projected_quantity: supply.projectedQuantity,
    status: deriveStatus(medication.archived_at, dosage_changes.length, currentDosage, supply.projectedQuantity),
    // Resolved in the user's own zone, so a box expiring today reads as expired
    // on the day the user calls today. S-02 compared against UTC here and
    // apologised for it; S-04 threads the user's date in instead.
    is_expired: medication.expiry_date < today,
  };
}

/**
 * Ordered by name and **not** filtered on `archived_at` — the island owns the
 * "Show archived" toggle, so the server hands it everything.
 *
 * Fetching archived rows alongside active ones bypasses
 * `medications_user_id_active_idx`, which is partial on `archived_at is null`.
 * Deliberate, and irrelevant at the PRD's volume.
 *
 * `today` is supplied by the caller and is the **user's** date. Every exported
 * function here takes it last, because every one of them returns a
 * `MedicationView` and a view classified in the wrong zone is a row that
 * disagrees with the list it lands in. Resolve it once per request with
 * `resolveTodayForUser` — never per row, and never in an island.
 */
export async function listMedications(client: SupabaseClient, today: string): Promise<Result<MedicationView[]>> {
  const { data, error } = await client.from("medications").select(MEDICATION_SELECT).order("name");

  if (error) {
    logDbError("list", error);
    return { ok: false, error: "unknown" };
  }

  return { ok: true, data: data.map((row) => toView(row, today)) };
}

/**
 * Re-reads one medication with the same embeds, so every mutation can answer
 * with a fully folded row. `.limit(1)` rather than `.single()`, because
 * `.single()` turns "no such row" into a PostgREST error and this needs it as a
 * domain outcome.
 */
async function readRow(client: SupabaseClient, id: string): Promise<Result<MedicationRow>> {
  const { data, error } = await client.from("medications").select(MEDICATION_SELECT).eq("id", id).limit(1);

  if (error) {
    logDbError("read", error);
    return { ok: false, error: "unknown" };
  }

  const row = data.at(0);
  if (!row) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, data: row };
}

async function readMedication(client: SupabaseClient, id: string, today: string): Promise<Result<MedicationView>> {
  const row = await readRow(client, id);
  return row.ok ? { ok: true, data: toView(row.data, today) } : row;
}

/**
 * Three ordered inserts, because a medication is three rows in three tables and
 * PostgREST has no transaction to wrap them in.
 *
 * **A failure after the first is not a create failure.** A medication with no
 * dosage row reads as dosage 0, and one with no supply events reads as quantity
 * 0 — both legal states the UI labels rather than warns about — so the partial
 * result is reported as success with whatever landed. The failed insert is
 * logged; nothing is rolled back, because there is nothing invalid to roll back.
 *
 * `form` is left to its `not null default 'solid'`. What actually has to hold
 * is that all four liquid columns stay NULL, `opened_on` included, or
 * `medications_liquid_fields_match_form` rejects the row — which is why the
 * payload is built field by field and the create schema refuses a body that
 * mentions them at all.
 */
export async function createMedication(
  client: SupabaseClient,
  input: MedicationCreateInput,
  today: string,
): Promise<Result<MedicationView>> {
  const { data: medication, error } = await client
    .from("medications")
    .insert({ name: input.name, specialist_id: input.specialist_id, expiry_date: input.expiry_date })
    .select("id")
    .single();

  if (error) {
    if (error.code === FK_VIOLATION) {
      return { ok: false, error: "no_specialist" };
    }
    logDbError("create", error);
    return { ok: false, error: "unknown" };
  }

  // The written dates are UTC, not the user's `today`: an RLS policy compares
  // both columns against Postgres `current_date`. See `todayUtc`.
  const written = todayUtc();

  const { error: dosageError } = await client
    .from("dosage_changes")
    .insert({ medication_id: medication.id, daily_dosage: input.daily_dosage, effective_date: written });
  if (dosageError) {
    logDbError("create.dosage", dosageError);
  }

  // A starting quantity of 0 writes NO row: `supply_events_refill_is_positive`
  // rejects a zero-delta refill, and a medication with no supply events already
  // reads as quantity 0. Reaching for an `adjustment` to force a row into
  // existence would record an event that never happened.
  if (input.quantity > 0) {
    const { error: supplyError } = await client.from("supply_events").insert({
      medication_id: medication.id,
      event_type: "refill",
      // Clamped on the way in — see the refill branch of `recordSupply`.
      quantity_delta: clampScale(input.quantity),
      occurred_on: written,
    });
    if (supplyError) {
      logDbError("create.supply", supplyError);
    }
  }

  return readMedication(client, medication.id, today);
}

/**
 * The payload is constructed explicitly and must never be spread from a request
 * body. `updated_at` is client-writable — the UPDATE policy constrains no
 * columns and `database.types.ts` exposes it on `Update` — and the
 * `check (updated_at >= created_at)` added by `20260821182457` closes only the
 * backdating half. This application path is the only lever on the other half,
 * so `.update({ ...input })` here would be a defect regardless of whether
 * anything currently fails.
 *
 * `.select()` is chained because under RLS an UPDATE against a missing or
 * foreign `id` matches zero rows and returns success with no error. An empty
 * result is the only signal that the row was not there.
 */
export async function updateMedicationDetails(
  client: SupabaseClient,
  id: string,
  input: MedicationDetailsInput,
  today: string,
): Promise<Result<MedicationView>> {
  const { data, error } = await client
    .from("medications")
    .update({
      name: input.name,
      specialist_id: input.specialist_id,
      expiry_date: input.expiry_date,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id");

  if (error) {
    if (error.code === FK_VIOLATION) {
      return { ok: false, error: "no_specialist" };
    }
    logDbError("update", error);
    return { ok: false, error: "unknown" };
  }

  if (data.length === 0) {
    return { ok: false, error: "not_found" };
  }
  return readMedication(client, id, today);
}

/**
 * Sets today's dosage, whether or not one was already set today.
 *
 * **`.upsert()` is not an option.** PostgREST compiles it to
 * `INSERT ... ON CONFLICT DO UPDATE`, and `dosage_changes` has no UPDATE
 * policy, so RLS refuses the conflict branch and the call fails rather than
 * replacing the row. DELETE-then-INSERT is the route, in that order: the DELETE
 * affects zero rows when nothing was set today, so one code path serves both
 * the first set and a same-day correction. Insert-first-and-recover-from-23505
 * costs an extra round trip on the correction path for the same non-atomic
 * window.
 *
 * **That window destroys data, so the DELETE is made reversible.** If the
 * INSERT fails after the DELETE has landed, the user's previous dosage is gone
 * — and since a missing row reads as 0 and 0 maps to `not_used`, the loss
 * renders as the deliberate "I have stopped taking this" state. The route
 * returns 500, but a reload shows a plausible row and nothing says a value was
 * deleted. Chaining `.select("daily_dosage")` onto the DELETE captures what it
 * removed so it can be put back, making a 500 honestly mean "nothing changed".
 * The compensating insert can itself fail; it logs under its own operation name
 * so the Workers log can tell that case apart from an ordinary failure.
 */
export async function setDosage(
  client: SupabaseClient,
  id: string,
  dailyDosage: number,
  today: string,
): Promise<Result<MedicationView>> {
  // `effective_date` is policy-compared, so it is UTC regardless of the user's
  // zone — including the `.eq()` the DELETE matches on, which has to name the
  // same day the INSERT is about to write.
  const written = todayUtc();

  const { data: removed, error: deleteError } = await client
    .from("dosage_changes")
    .delete()
    .eq("medication_id", id)
    .eq("effective_date", written)
    .select("daily_dosage");

  if (deleteError) {
    logDbError("setDosage.delete", deleteError);
    return { ok: false, error: "unknown" };
  }

  const { error: insertError } = await client
    .from("dosage_changes")
    .insert({ medication_id: id, daily_dosage: dailyDosage, effective_date: written });

  if (insertError) {
    // An unresolvable `(medication_id, user_id)` means there is no such
    // medication for this user — a domain outcome, so it is not logged. The
    // DELETE above matched nothing for the same reason, so there is normally
    // nothing to compensate; the restore below still runs, for the case where
    // the medication disappeared between the two calls.
    const missing = insertError.code === FK_VIOLATION;
    if (!missing) {
      logDbError("setDosage.insert", insertError);
    }

    const previous = removed.at(0);
    if (previous) {
      const { error: restoreError } = await client
        .from("dosage_changes")
        .insert({ medication_id: id, daily_dosage: previous.daily_dosage, effective_date: written });
      if (restoreError) {
        logDbError("setDosage.restore", restoreError);
      }
    }

    return { ok: false, error: missing ? "not_found" : "unknown" };
  }

  return readMedication(client, id, today);
}

/**
 * A refill appends what was added. A correction states the counted total, and
 * is recorded as a `recount` carrying both figures — what was counted and what
 * the engine projected — so the discrepancy between them is a fact in the
 * ledger rather than a number folded away.
 *
 * S-02 wrote this branch as an `adjustment` derived from the ledger sum,
 * because "an honest recount needs the `projected_quantity` only S-04's
 * consumption engine can supply". It supplies it now. That also removes the
 * stale-base race S-02 documented: the projection comes from the same read that
 * produces the row, and `supply_events_recount_delta_is_discrepancy` rejects
 * any row where the three figures disagree.
 */
export async function recordSupply(
  client: SupabaseClient,
  id: string,
  input: SupplyInput,
  today: string,
): Promise<Result<MedicationView>> {
  // `occurred_on` is policy-compared, so it is UTC; `today` classifies the view
  // that goes back to the page. The two may differ by a calendar day.
  const written = todayUtc();

  if (input.kind === "refill") {
    // Clamped for the same reason `counted` is below, one door further along.
    // Zod bounds magnitude and not precision, so a raw request may send seven
    // decimal places; stored unclamped, they reach the engine and the next
    // correction on this medication derives its delta at six places against a
    // seven-place projection. Postgres compares in exact `numeric` and answers
    // `23514`. Rounding on the way in keeps every projection derived from this
    // ledger within the scale `subtractExact` works at.
    const { error } = await client.from("supply_events").insert({
      medication_id: id,
      event_type: "refill",
      quantity_delta: clampScale(input.amount),
      occurred_on: written,
    });

    if (error) {
      if (error.code === FK_VIOLATION) {
        return { ok: false, error: "not_found" };
      }
      logDbError("recordSupply.refill", error);
      return { ok: false, error: "unknown" };
    }
    return readMedication(client, id, today);
  }

  const row = await readRow(client, id);
  if (!row.ok) {
    return row;
  }

  // As of `written`, NOT the user's `today`: this figure is stamped onto a row
  // dated `occurred_on = written`, and a projection has to be as of the date it
  // carries. The two may differ by a calendar day, so it is computed here
  // rather than read off the `MedicationView` the same call returns.
  //
  // The projection deliberately excludes the row about to be written. Applying
  // this recount's own delta first would make the projection self-referential —
  // the CHECK would still pass, and every correction would record a zero
  // discrepancy.
  const { projectedQuantity } = computeSupply({
    events: row.data.supply_events,
    dosages: row.data.dosage_changes,
    expiryDate: row.data.expiry_date,
    today: written,
  });

  // Rounded once, up front, and used for BOTH the stored column and the delta.
  // `counted_quantity` is `numeric` with unbounded scale while `subtractExact`
  // works at six places, so storing the raw value would let the column and the
  // delta disagree at the seventh decimal — and Postgres, comparing in exact
  // `numeric`, answers `23514`. Zod bounds magnitude, not precision, so
  // `counted: 0.1234567` is a body the route accepts. The cost is honesty about
  // the seventh decimal; the row records `0.123457`, which is three orders of
  // magnitude past anything dispensable.
  const counted = clampScale(input.counted);
  // `subtractExact`, never `-`: a JS `0.3 - 0.1` serialises as
  // `0.19999999999999998` where Postgres computes `0.2`, and the CHECK compares
  // in exact `numeric`. That failure would surface as an unexplained "Could not
  // record the supply change".
  const delta = subtractExact(counted, projectedQuantity);

  // Already at the counted figure. A recount recording no discrepancy says
  // nothing, so the unchanged row is the answer — a successful no-op, not a
  // validation failure.
  if (delta === 0) {
    return { ok: true, data: toView(row.data, today) };
  }

  const { error } = await client.from("supply_events").insert({
    medication_id: id,
    event_type: "recount",
    quantity_delta: delta,
    counted_quantity: counted,
    projected_quantity: projectedQuantity,
    occurred_on: written,
  });

  if (error) {
    if (error.code === FK_VIOLATION) {
      return { ok: false, error: "not_found" };
    }
    logDbError("recordSupply.correction", error);
    return { ok: false, error: "unknown" };
  }
  return readMedication(client, id, today);
}

/**
 * FR-007's archival, and its undo. `medications` has no DELETE policy at all,
 * so this is the only way a row leaves the active list. As elsewhere,
 * `.select()` distinguishes "updated" from the zero-rows success RLS returns
 * for a missing or foreign `id`.
 */
export async function setArchived(
  client: SupabaseClient,
  id: string,
  archived: boolean,
  today: string,
): Promise<Result<MedicationView>> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("medications")
    .update({ archived_at: archived ? now : null, updated_at: now })
    .eq("id", id)
    .select("id");

  if (error) {
    logDbError("setArchived", error);
    return { ok: false, error: "unknown" };
  }

  if (data.length === 0) {
    return { ok: false, error: "not_found" };
  }
  return readMedication(client, id, today);
}
