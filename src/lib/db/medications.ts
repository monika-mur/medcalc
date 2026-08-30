import type { Tables } from "@/db/database.types";
import { resolveToday } from "@/lib/dates";
import type { SupabaseClient } from "@/lib/supabase";
import type { MedicationCreateInput, MedicationDetailsInput, SupplyInput } from "@/lib/validation/medication";

export type Medication = Tables<"medications">;

/**
 * Derived, in this precedence order. Archival wins because it is the user's
 * explicit "hide this"; a stopped medication is reported as stopped rather than
 * as empty, because the intent is the more informative fact.
 */
export type MedicationStatus = "archived" | "not_used" | "out_of_stock" | "active";

/**
 * A medication plus the two numbers that are NOT columns on it. Dosage lives
 * only in `dosage_changes` and quantity only in `supply_events` deltas
 * (`CLAUDE.md` -> _Domain schema_); the absence of a cached copy is what makes
 * drift impossible, so they are folded on read rather than stored.
 *
 * `is_expired` is reported beside `status`, not folded into it: a medication
 * can be expired AND in any of the four states.
 */
export interface MedicationView extends Medication {
  specialist: { id: string; name: string; specialty: string };
  current_dosage: number;
  quantity_on_hand: number;
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
  "*, specialists(id, name, specialty), dosage_changes(daily_dosage, effective_date), supply_events(quantity_delta)";

/**
 * No function here filters by `user_id`. RLS does that, and a redundant filter
 * would hide a policy regression from any test that looks for one.
 */

interface MedicationRow extends Medication {
  specialists: { id: string; name: string; specialty: string } | null;
  dosage_changes: { daily_dosage: number; effective_date: string }[];
  supply_events: { quantity_delta: number }[];
}

/**
 * The dosage in force today: the greatest `effective_date` that is not in the
 * future. Dates are `YYYY-MM-DD`, so lexicographic comparison IS chronological
 * comparison and no parsing is needed.
 *
 * Rows dated after today are skipped rather than treated as current. Nothing in
 * this slice writes one, but the schema and the relaxed DELETE policy both
 * permit them and S-05 will, so the fold must already be right when they
 * appear.
 *
 * No row at all reads as 0 — a legal state, not missing data.
 */
function foldDosage(rows: { daily_dosage: number; effective_date: string }[], today: string): number {
  let current: { daily_dosage: number; effective_date: string } | null = null;
  for (const row of rows) {
    if (row.effective_date > today) continue;
    if (!current || row.effective_date > current.effective_date) {
      current = row;
    }
  }
  return current ? current.daily_dosage : 0;
}

function deriveStatus(archivedAt: string | null, currentDosage: number, quantityOnHand: number): MedicationStatus {
  if (archivedAt !== null) return "archived";
  if (currentDosage === 0) return "not_used";
  if (quantityOnHand <= 0) return "out_of_stock";
  return "active";
}

/**
 * The fold is the S-04 replacement point. When the current-state views land,
 * this arithmetic moves into SQL and `MedicationView` stops being computed
 * here — the exported signatures do not change.
 */
function toView(row: MedicationRow, today: string): MedicationView {
  const { specialists, dosage_changes, supply_events, ...medication } = row;

  const currentDosage = foldDosage(dosage_changes, today);
  const quantityOnHand = supply_events.reduce((sum, event) => sum + event.quantity_delta, 0);

  return {
    ...medication,
    // `specialist_id` is `not null` and the composite FK guarantees a visible
    // parent, so this fallback guards against a shape change in the embed, not
    // against a state the database permits.
    specialist: specialists ?? { id: medication.specialist_id, name: "Unknown specialist", specialty: "" },
    current_dosage: currentDosage,
    quantity_on_hand: quantityOnHand,
    status: deriveStatus(medication.archived_at, currentDosage, quantityOnHand),
    // Compared against UTC today, which can differ by a day from the user's own
    // date near midnight. Immaterial for a date printed on a box, and the
    // user-zone resolution this would otherwise want is S-03's `resolveToday`,
    // which this slice deliberately does not import.
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
 */
export async function listMedications(client: SupabaseClient): Promise<Result<MedicationView[]>> {
  const { data, error } = await client.from("medications").select(MEDICATION_SELECT).order("name");

  if (error) {
    logDbError("list", error);
    return { ok: false, error: "unknown" };
  }

  const today = todayUtc();
  return { ok: true, data: data.map((row) => toView(row, today)) };
}

/**
 * Re-reads one medication with the same embeds, so every mutation can answer
 * with a fully folded row. `.limit(1)` rather than `.single()`, because
 * `.single()` turns "no such row" into a PostgREST error and this needs it as a
 * domain outcome.
 */
async function readMedication(client: SupabaseClient, id: string): Promise<Result<MedicationView>> {
  const { data, error } = await client.from("medications").select(MEDICATION_SELECT).eq("id", id).limit(1);

  if (error) {
    logDbError("read", error);
    return { ok: false, error: "unknown" };
  }

  const row = data.at(0);
  if (!row) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, data: toView(row, todayUtc()) };
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

  const today = todayUtc();

  const { error: dosageError } = await client
    .from("dosage_changes")
    .insert({ medication_id: medication.id, daily_dosage: input.daily_dosage, effective_date: today });
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
      quantity_delta: input.quantity,
      occurred_on: today,
    });
    if (supplyError) {
      logDbError("create.supply", supplyError);
    }
  }

  return readMedication(client, medication.id);
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
  return readMedication(client, id);
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
): Promise<Result<MedicationView>> {
  const today = todayUtc();

  const { data: removed, error: deleteError } = await client
    .from("dosage_changes")
    .delete()
    .eq("medication_id", id)
    .eq("effective_date", today)
    .select("daily_dosage");

  if (deleteError) {
    logDbError("setDosage.delete", deleteError);
    return { ok: false, error: "unknown" };
  }

  const { error: insertError } = await client
    .from("dosage_changes")
    .insert({ medication_id: id, daily_dosage: dailyDosage, effective_date: today });

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
        .insert({ medication_id: id, daily_dosage: previous.daily_dosage, effective_date: today });
      if (restoreError) {
        logDbError("setDosage.restore", restoreError);
      }
    }

    return { ok: false, error: missing ? "not_found" : "unknown" };
  }

  return readMedication(client, id);
}

/**
 * A refill appends what was added. A correction states the counted total, so
 * the module reads the ledger sum and appends the difference as an
 * `adjustment` — `recount` is not used here, because an honest recount needs
 * the `projected_quantity` only S-04's consumption engine can supply.
 *
 * `counted_quantity` and `projected_quantity` are left unset:
 * `supply_events_recount_fields_match_type` requires both to be NULL on a
 * non-recount.
 *
 * The correction reads before it writes, so two tabs correcting at once race
 * and the later write wins on a stale base. Accepted at this volume and
 * single-user scope; S-04's `recount` is the structural fix, since it records
 * the counted figure itself rather than a delta derived from a read.
 */
export async function recordSupply(
  client: SupabaseClient,
  id: string,
  input: SupplyInput,
): Promise<Result<MedicationView>> {
  const today = todayUtc();

  if (input.kind === "refill") {
    const { error } = await client
      .from("supply_events")
      .insert({ medication_id: id, event_type: "refill", quantity_delta: input.amount, occurred_on: today });

    if (error) {
      if (error.code === FK_VIOLATION) {
        return { ok: false, error: "not_found" };
      }
      logDbError("recordSupply.refill", error);
      return { ok: false, error: "unknown" };
    }
    return readMedication(client, id);
  }

  const current = await readMedication(client, id);
  if (!current.ok) {
    return current;
  }

  const delta = input.counted - current.data.quantity_on_hand;
  // Already at the counted figure. Appending a zero-delta `adjustment` would
  // record an event that says nothing, so the unchanged row is the answer — a
  // successful no-op, not a validation failure.
  if (delta === 0) {
    return current;
  }

  const { error } = await client
    .from("supply_events")
    .insert({ medication_id: id, event_type: "adjustment", quantity_delta: delta, occurred_on: today });

  if (error) {
    if (error.code === FK_VIOLATION) {
      return { ok: false, error: "not_found" };
    }
    logDbError("recordSupply.correction", error);
    return { ok: false, error: "unknown" };
  }
  return readMedication(client, id);
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
  return readMedication(client, id);
}
