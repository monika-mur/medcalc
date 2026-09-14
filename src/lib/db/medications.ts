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
 * `not_started` is the third question in that same family, and S-05 split it out
 * of `not_used`: a medication with nothing in force today but a real dose
 * scheduled folds to `current_dosage: 0` the same way a genuine stop does, so
 * before the split it read as "Stopped" — the wrong word for "starts next
 * Monday". It sits after `no_dosage` and before `not_used` because a medication
 * with nothing in force has no dosage today either way, and "one is coming" is
 * the more specific answer.
 *
 * **Reachable two ways, not one.** The originally-scoped path is a medication
 * whose dosage rows are ALL future-dated — no row at all takes effect on or
 * before today. The other path is a row *in force* today whose value is 0,
 * with a nonzero row scheduled after it: creating a medication at dosage 0 and
 * scheduling the real dose later is a normal thing to try through the panel,
 * since 0 is a legal value on the create form. An earlier draft of this
 * comment claimed the second path needed `cancelDosageChange`, on the
 * reasoning that the create form always leaves a row at `todayUtc` — true, but
 * it missed that the row it leaves can itself be 0. `deriveStatus` tests
 * `currentDosage === 0` either way, so both paths collapse to one check —
 * gated on the pending row's *value*, not merely its presence, so a second
 * pending 0/day row (re-confirming a stop) still reads `not_used` rather than
 * misfiring into "starts soon".
 */
export type MedicationStatus = "archived" | "no_dosage" | "not_started" | "not_used" | "out_of_stock" | "active";

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
 * can be expired AND in any of the six states.
 *
 * `pending_dosage_changes` is the scheduled-but-not-yet-effective tail of the
 * dosage series, ascending. It is derived from rows `MEDICATION_SELECT` already
 * embeds — no second query — and it is the ONLY copy: an earlier draft carried
 * the soonest change beside the array it is the head of, which is the second
 * copy this view's whole schema rule exists to prevent. Read `[0]` for the next
 * one.
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
  pending_dosage_changes: { daily_dosage: number; effective_date: string }[];
}

/**
 * The soonest pending change that actually starts a dosage, or `undefined`.
 *
 * **Not `pending[0]`, and the difference is the whole reason this exists.** A
 * medication can carry a scheduled stop followed by a later scheduled resume,
 * so the soonest pending row can itself be 0/day. `not_started` fires whenever a
 * nonzero row is pending *anywhere* in the series, so anything naming the day
 * the dosage begins has to skip the zeros to agree with the status it is
 * labelling.
 *
 * It is one exported function rather than three `.find()` calls — `deriveStatus`'s
 * trigger, the dashboard's reason line and the medications-list label — for the
 * reason `nextVisitFor` (`@/lib/dashboard`) gives for existing at all: defining
 * it twice is how they end up disagreeing about one row. The rule is the shipped
 * `not_started` contract; see the plan's Phase 2 §4.
 */
export function nextNonzeroPendingChange(
  pending: MedicationView["pending_dosage_changes"],
): MedicationView["pending_dosage_changes"][number] | undefined {
  return pending.find((change) => change.daily_dosage !== 0);
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
 *
 * `date_not_allowed` is a `with check` refusal on `dosage_changes` — an
 * `effective_date` before Postgres `current_date`. Two things reach it: a raw
 * request that back-dates a row, and the two-clock window where the Worker
 * resolves today at 23:59:59.9 UTC and Postgres sees the next day. Routes answer
 * it **400 with `fieldErrors.effective_date`**, because for the first case the
 * value came from a date input and a field error is the shape the island can act
 * on. It is NOT `unknown`/500: an unexplained 500 is exactly what this kind
 * exists to stop.
 */
export type MedicationErrorKind = "not_found" | "no_specialist" | "date_not_allowed" | "unknown";

export type Result<T> = { ok: true; data: T } | { ok: false; error: MedicationErrorKind };

/** `foreign_key_violation` — raised by the composite `(x_id, user_id)` FKs. */
const FK_VIOLATION = "23503";

/**
 * `insufficient_privilege` — what a `with check` violation raises. Distinct from
 * the zero-rows-and-no-error semantics `append_only.test.sql:4-7` documents for
 * a command with no matching policy at all: a policy that exists and refuses the
 * row errors, a command with no policy silently matches nothing.
 */
const RLS_VIOLATION = "42501";

/**
 * `unique_violation` — here, only ever `unique (medication_id, effective_date)`.
 * The ordinary write paths keep it unreachable by construction (DELETE-then-
 * INSERT on the target date), so the one place it is handled rather than
 * prevented is `setDosage`'s restore retry, where it is a benign outcome rather
 * than a failure. See that branch.
 */
const UNIQUE_VIOLATION = "23505";

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
 *
 * `not_started` fires on `currentDosage === 0 && hasNonzeroPending` — nothing
 * is in force today, but a real (nonzero) dose is coming — not on "every row
 * is future-dated". A first draft used the narrower test and Metypred (created
 * at 0/day, real dose scheduled later) still read `not_used`: the create form
 * always leaves a row at `todayUtc`, and that row can itself be 0. Since
 * `currentDosage` already folds "no row in force" and "a 0-row in force" to the
 * same number, one test covers both paths without asking which one a caller is
 * in.
 *
 * The pending row's *value* is what tells this apart from an ordinary stop, not
 * merely its presence: a medication stopped today with a second 0/day row also
 * scheduled — a user re-confirming a stop, or a mis-click — is still "zero and
 * staying zero", so `not_used` is the honest word for it. Only a nonzero
 * pending row promises a different number is coming.
 */
function deriveStatus(
  archivedAt: string | null,
  dosageCount: number,
  hasNonzeroPending: boolean,
  currentDosage: number,
  projectedQuantity: number,
): MedicationStatus {
  if (archivedAt !== null) return "archived";
  if (dosageCount === 0) return "no_dosage";
  if (currentDosage === 0 && hasNonzeroPending) return "not_started";
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
  // Strictly after `today`, so a row effective today is in force and not
  // pending. `today` here is the **user's** date, matching how `current_dosage`
  // and `is_expired` are resolved just below — "pending" means pending from the
  // reader's point of view.
  //
  // That is deliberately NOT the day Phase 3's date field is anchored to, which
  // is UTC because the INSERT policy is. West of UTC in the evening the two
  // disagree by a calendar day and a medication's own current row is classified
  // as pending. Accepted risk, recorded as F5 in `plan.md` → _Critical
  // Implementation Details_, and it resolves with S-04's F0b follow-up
  // (`supply-status-dashboard/follow-ups/timezone-classification.md`) rather
  // than on its own. Do not "fix" it by resolving the field's bound in the
  // user's zone — that offers a date the policy refuses.
  //
  // Sorted here rather than in the query: PostgREST does not order an embedded
  // resource without an explicit hint, and the UI lists these by date.
  const pendingChanges = [...dosage_changes]
    .filter((change) => change.effective_date > today)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
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
    status: deriveStatus(
      medication.archived_at,
      dosage_changes.length,
      nextNonzeroPendingChange(pendingChanges) !== undefined,
      currentDosage,
      supply.projectedQuantity,
    ),
    pending_dosage_changes: pendingChanges,
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
  // A refusal is NOT the partial-create case this function's header describes.
  // The header's reasoning is that a missing dosage row is a legal state the
  // UI labels — true when the insert failed for an ordinary reason. Under the
  // tightened INSERT policy there is a new way to get here: `written` was
  // resolved from the Worker's clock and Postgres has since rolled past UTC
  // midnight. Reporting that as a successful create hands back a silently
  // `no_dosage` medication with the user's number thrown away. The medication
  // row does exist by now and is not rolled back — PostgREST has no
  // transaction to do it in — so the route says so rather than pretending
  // either that nothing happened or that everything did.
  //
  // **The refusal is recorded and answered below, not returned here.** Only
  // `dosage_changes` is date-guarded; `supply_events_insert_own` is ownership-
  // only (`20260821182457:140`), so the starting quantity would have been
  // written had the attempt been made. Returning at this point skipped it and
  // lost a second figure the user typed, while the route's message named only
  // the dosage — so the salvageable insert runs first and the refusal is
  // reported afterwards.
  let dosageRefused = false;
  if (dosageError) {
    logDbError("create.dosage", dosageError);
    dosageRefused = dosageError.code === RLS_VIOLATION;
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

  if (dosageRefused) {
    return { ok: false, error: "date_not_allowed" };
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
 * Sets the dosage in force from `effectiveDate` — today when the caller names no
 * date — whether or not one was already set for that day.
 *
 * **The DELETE keys on the target date, not on today, and that is load-bearing.**
 * It is what keeps `23505` unreachable by construction: the row occupying the
 * requested slot is removed before the insert, so `unique (medication_id,
 * effective_date)` can never be the thing that reports a mistake. It is also
 * what makes "schedule onto a date that already holds a change" mean "replace",
 * which is the same semantics that has always been live for today's row rather
 * than a new rule for future ones.
 *
 * `effectiveDate` sits BEFORE `today` in the parameter list even though it is
 * the optional one, because every exported function here takes `today` last —
 * see `listMedications`. The cost is that the one existing call site passes
 * `undefined` explicitly, which is the cheaper half of the trade: a new call
 * site cannot forget the parameter exists.
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
 *
 * **And since S-05 it can fail for a reason the restore cannot survive.** If the
 * INSERT was refused `42501` because UTC midnight passed after the DELETE
 * committed, re-inserting at the same — now past — date is refused for exactly
 * the same reason, and the value the DELETE captured is gone for good. So a
 * refused restore is retried once at a freshly-resolved UTC today, whatever the
 * caller named. The retry is NOT gated on the date having been server-derived:
 * the caller never asked for the removed row to move, so putting its value back
 * on the current day is not relocating their request — and the client cannot be
 * trusted to signal "untouched" anyway, since it compares the field against a
 * `utcToday` frozen at page render. The retried row lands a day
 * later than the one that was removed, so the series has a one-day seam where
 * `doseInForce` reads whatever preceded it — the cost of not destroying the
 * user's number.
 */
export async function setDosage(
  client: SupabaseClient,
  id: string,
  dailyDosage: number,
  effectiveDate: string | undefined,
  today: string,
): Promise<Result<MedicationView>> {
  // `effective_date` is policy-compared, so the default is UTC regardless of the
  // user's zone — including the `.eq()` the DELETE matches on, which has to name
  // the same day the INSERT is about to write. A caller-supplied date is already
  // floored against the server's UTC today by `dosageInputSchemaFor`; this is
  // not the place that check belongs, because the policy is the actual guard and
  // a second one here would only disagree with it at a day boundary.
  const written = effectiveDate ?? todayUtc();

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
    const refused = insertError.code === RLS_VIOLATION;
    if (!missing) {
      // A refusal IS logged, unlike the other expected domain outcome: reaching
      // it means either a raw request that got past the schema or the two-clock
      // midnight window, and both are worth a trace.
      logDbError("setDosage.insert", insertError);
    }

    const previous = removed.at(0);
    if (previous) {
      const { error: restoreError } = await client
        .from("dosage_changes")
        .insert({ medication_id: id, daily_dosage: previous.daily_dosage, effective_date: written });
      if (restoreError) {
        logDbError("setDosage.restore", restoreError);

        // The restore was refused for the same reason the INSERT was: `written`
        // is now in Postgres's past. Put the value back on the day that IS
        // current instead of losing it — only when the day has actually moved,
        // since retrying at the same date would just be refused again.
        const retryDate = todayUtc();
        if (restoreError.code === RLS_VIOLATION && retryDate !== written) {
          const { error: retryError } = await client
            .from("dosage_changes")
            .insert({ medication_id: id, daily_dosage: previous.daily_dosage, effective_date: retryDate });
          // A collision here is NOT a failure and must not be cleared out of the
          // way. `retryDate` is occupied only when a row has just become
          // effective today — typically a change this slice scheduled — so a
          // dosage IS in force and there is nothing left to restore. Mirroring
          // the primary path's DELETE-then-INSERT would destroy that row and
          // write a stale value over it, which is the loss this retry exists to
          // prevent. The unrecovered row at `written` is the one-day seam the
          // header already accepts.
          if (retryError && retryError.code !== UNIQUE_VIOLATION) {
            logDbError("setDosage.restore.retry", retryError);
          }
        }
      }
    }

    if (missing) {
      return { ok: false, error: "not_found" };
    }
    return { ok: false, error: refused ? "date_not_allowed" : "unknown" };
  }

  return readMedication(client, id, today);
}

/**
 * Removes one dosage row by the date it takes effect — the undo for a scheduled
 * change, and the only correction available, since `dosage_changes` has no
 * UPDATE policy and never will.
 *
 * **Zero rows is not success.** `dosage_changes_delete_uncommitted_own` is an
 * RLS policy, so a DELETE against a missing row, a stranger's row, or a row that
 * has already taken effect matches nothing and returns success with no error —
 * `CLAUDE.md` → _API conventions_. Chaining `.select()` is the only way to tell
 * those apart from a real removal; without it, cancelling someone else's
 * scheduled change would answer 204.
 *
 * **No date floor here, deliberately.** The DELETE policy admits
 * `effective_date >= current_date`, so this also removes TODAY's row — the
 * dosage currently in force — not only not-yet-effective ones. The panel never
 * offers that, because it lists pending changes only; the API does. It is the
 * one path by which the application can produce a `not_started` medication, and
 * `setDosage` puts the row back whenever the user wants it. Do not "tighten"
 * this into a floor.
 */
export async function cancelDosageChange(
  client: SupabaseClient,
  id: string,
  effectiveDate: string,
  today: string,
): Promise<Result<MedicationView>> {
  const { data, error } = await client
    .from("dosage_changes")
    .delete()
    .eq("medication_id", id)
    .eq("effective_date", effectiveDate)
    .select("effective_date");

  if (error) {
    logDbError("cancelDosageChange", error);
    return { ok: false, error: "unknown" };
  }

  if (data.length === 0) {
    return { ok: false, error: "not_found" };
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
