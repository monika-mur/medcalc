import { useState, type SubmitEvent } from "react";
import { Archive, ArchiveRestore, Calculator, Gauge, Package, Pencil, Plus } from "lucide-react";
import { FormField } from "@/components/form/FormField";
import { SelectField, type SelectOption } from "@/components/form/SelectField";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { ApiErrorBody } from "@/lib/api/json";
import { zodFieldErrors } from "@/lib/api/json";
import { nextNonzeroPendingChange, type MedicationStatus, type MedicationView } from "@/lib/db/medications";
import type { SpecialistWithUsage } from "@/lib/db/specialists";
import { discrepancyPhrase } from "@/lib/notices";
import {
  dosageInputSchemaFor,
  medicationCreateSchema,
  medicationDetailsSchema,
  supplyInputSchema,
} from "@/lib/validation/medication";

interface Props {
  /** Rendered server-side by `medications.astro`, so the list paints with the page. */
  initialMedications: MedicationView[];
  /** `specialist_id` is `not null`, so an empty list means no medication can be added. */
  specialists: SpecialistWithUsage[];
  /**
   * Either server-side read failed, so `initialMedications` is empty because
   * nothing could be fetched — not because the user has nothing. The two look
   * identical from in here, and telling them apart is what keeps the island
   * from inviting a duplicate of a medication it simply could not see.
   */
  loadFailed: boolean;
  /**
   * Today in **UTC**, resolved by `medications.astro`. The floor for a scheduled
   * `effective_date`, because the INSERT policy compares that column against
   * Postgres `current_date`. Never derived in here — `CLAUDE.md` → _Dates_ — and
   * deliberately not the zone the rows on screen were classified in, which is
   * the user's. The two may differ by a calendar day.
   */
  utcToday: string;
}

type FieldErrors = Record<string, string>;

interface Notice {
  tone: "success" | "error";
  text: string;
}

/** One row's expandable form. Only one is open at a time, so one set of field state serves all four. */
type PanelKind = "edit" | "dosage" | "refill" | "correct";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * The badge always carries a word — colour is the redundant cue, never the only
 * one. Green is rationed to `active`, red to the two states the user has to act
 * on; the rest are neutral because they are states the user chose, not
 * warnings.
 *
 * `no_dosage` is red rather than muted because it is not a state anyone chose:
 * the medication has no `dosage_changes` row at all, so nothing about its
 * supply can be calculated. Both maps are `Record<MedicationStatus, string>`,
 * so adding a variant to that union fails the build until it is labelled here —
 * which is the reason the variant lives on the union rather than being derived
 * ad hoc on the dashboard.
 */
const STATUS_LABEL: Record<MedicationStatus, string> = {
  active: "Active",
  no_dosage: "No dosage recorded",
  // Neutral, not a warning: nothing is wrong with a medication that starts next
  // week. Static because the map is keyed by status alone; Phase 3 renders the
  // start date beside it, from `pending_dosage_changes[0]`.
  not_started: "Not started yet",
  not_used: "Not used",
  out_of_stock: "Out of stock",
  archived: "Archived",
};

const STATUS_CLASS: Record<MedicationStatus, string> = {
  active: "text-primary",
  no_dosage: "text-destructive",
  not_started: "text-muted-foreground",
  not_used: "text-muted-foreground",
  out_of_stock: "text-destructive",
  archived: "text-muted-foreground",
};

/** The list is ordered by name server-side; keep local edits in the same order. */
function byName(a: MedicationView, b: MedicationView) {
  return a.name.localeCompare(b.name);
}

/**
 * An empty or non-numeric field becomes `NaN`, which zod reports with the
 * schema's own "Enter … as a number" message. Parsing here rather than leaning
 * on `<input type="number">` keeps the message identical to the one the route
 * would answer with.
 */
function toNumber(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/**
 * Reads the `{ error: { message, fieldErrors? } }` contract the domain routes
 * answer with. A body that does not match it — a proxy error page, a truncated
 * response — falls back to the generic message rather than throwing.
 */
async function readApiError(response: Response): Promise<{ message: string; fieldErrors?: FieldErrors }> {
  try {
    const body: unknown = await response.json();
    const error = (body as Partial<ApiErrorBody>).error;
    if (error && typeof error.message === "string") {
      return { message: error.message, fieldErrors: error.fieldErrors };
    }
  } catch {
    // Fall through to the generic message.
  }
  return { message: GENERIC_ERROR };
}

/**
 * The `<select>`'s options. S-02 originally carried a local `SpecialistSelect`
 * here, deliberately: S-03 was introducing the shared `SelectField` in a
 * sibling worktree at the same time, and both branches creating that file would
 * have been a create/create conflict. S-03 merged second and made the swap, per
 * its plan's _Parallel-slice coordination_ — so this file now builds only the
 * option list and the shared component renders it.
 */
function specialistOptions(specialists: SpecialistWithUsage[]): SelectOption[] {
  return specialists.map((specialist) => ({
    value: specialist.id,
    label: `${specialist.name} — ${specialist.specialty}`,
  }));
}

export default function MedicationsManager({ initialMedications, specialists, loadFailed, utcToday }: Props) {
  const [medications, setMedications] = useState(initialMedications);
  const [showArchived, setShowArchived] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [addName, setAddName] = useState("");
  const [addSpecialistId, setAddSpecialistId] = useState("");
  const [addExpiry, setAddExpiry] = useState("");
  const [addDosage, setAddDosage] = useState("");
  const [addQuantity, setAddQuantity] = useState("");
  const [addErrors, setAddErrors] = useState<FieldErrors>({});

  const [panel, setPanel] = useState<{ id: string; kind: PanelKind } | null>(null);
  const [panelErrors, setPanelErrors] = useState<FieldErrors>({});
  const [editName, setEditName] = useState("");
  const [editSpecialistId, setEditSpecialistId] = useState("");
  const [editExpiry, setEditExpiry] = useState("");
  const [dosageValue, setDosageValue] = useState("");
  // Seeded from the `utcToday` prop whenever the panel opens, never from a
  // clock in here — `CLAUDE.md` → _Dates_.
  const [dosageDate, setDosageDate] = useState(utcToday);
  // Whether the user has actually chosen a date this time the panel was opened.
  // This, and NOT a comparison against `utcToday`, is what "the field was left
  // alone" means: `utcToday` is a prop frozen at page render, so on a tab left
  // open across UTC midnight the seeded value silently becomes a past date, and
  // equality against it stops answering the question being asked.
  const [dosageDateTouched, setDosageDateTouched] = useState(false);
  const [refillValue, setRefillValue] = useState("");
  const [countedValue, setCountedValue] = useState("");
  /**
   * The pending replace-confirm, or `null`. Holds the whole submission rather
   * than a boolean, so the dialog can name both values and the confirm can fire
   * the exact call that was intercepted.
   */
  const [replacePrompt, setReplacePrompt] = useState<{
    id: string;
    name: string;
    dailyDosage: number;
    effectiveDate: string;
    replacing: number;
  } | null>(null);

  // Adding is offered only when the page knows what is already there. After a
  // failed read the list is empty because nothing loaded, so an add form here
  // would invite a second copy of a medication the user already tracks — and
  // `medications` has no DELETE policy, so the only cleanup is archival.
  const canAdd = specialists.length > 0 && !loadFailed;
  const archivedCount = medications.filter((row) => row.archived_at !== null).length;
  const visible = medications.filter((row) => showArchived || row.archived_at === null);

  /**
   * Every mutation in this slice answers with the refreshed `MedicationView`,
   * so one helper covers all six. Field errors land wherever the caller points
   * them: an unresolvable `specialist_id` arrives from the route as a 400 with
   * a `fieldErrors` entry, which renders under the `<select>` exactly as a zod
   * failure would.
   */
  async function send(
    method: "POST" | "PATCH" | "DELETE",
    url: string,
    body: unknown,
    setErrors: (errors: FieldErrors) => void,
  ): Promise<MedicationView | null> {
    setNotice(null);
    setPending(true);
    try {
      // The cancel endpoint is addressed entirely by its URL, so it sends no
      // body — and a `Content-Type: application/json` header on a bodyless
      // request advertises a payload that is not there. Widening this helper
      // rather than dropping to an inline `fetch` (as the specialists and
      // visits islands do) is deliberate: `send` is what parses the refreshed
      // `MedicationView` out of the response and routes `fieldErrors` to the
      // right control, and the cancel needs both.
      const hasBody = body !== undefined;
      const response = await fetch(url, {
        method,
        headers: hasBody ? { "Content-Type": "application/json" } : {},
        body: hasBody ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const error = await readApiError(response);
        setErrors(error.fieldErrors ?? {});
        setNotice({ tone: "error", text: error.message });
        return null;
      }
      return (await response.json()) as MedicationView;
    } catch {
      setNotice({ tone: "error", text: GENERIC_ERROR });
      return null;
    } finally {
      setPending(false);
    }
  }

  function applyRow(updated: MedicationView) {
    setMedications((previous) => {
      const known = previous.some((row) => row.id === updated.id);
      const next = known ? previous.map((row) => (row.id === updated.id ? updated : row)) : [...previous, updated];
      return next.sort(byName);
    });
  }

  function closePanel() {
    setPanel(null);
    setPanelErrors({});
  }

  function openPanel(medication: MedicationView, kind: PanelKind) {
    setNotice(null);
    setPanelErrors({});
    setPanel({ id: medication.id, kind });
    if (kind === "edit") {
      setEditName(medication.name);
      setEditSpecialistId(medication.specialist_id);
      setEditExpiry(medication.expiry_date);
    } else if (kind === "dosage") {
      setDosageValue(String(medication.current_dosage));
      setDosageDate(utcToday);
      setDosageDateTouched(false);
    } else if (kind === "refill") {
      setRefillValue("");
    } else {
      setCountedValue(String(medication.projected_quantity));
    }
  }

  async function handleAdd(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    // The same schema the route validates with, so a value the server would
    // reject never leaves the page.
    const parsed = medicationCreateSchema.safeParse({
      name: addName,
      specialist_id: addSpecialistId,
      expiry_date: addExpiry,
      daily_dosage: toNumber(addDosage),
      quantity: toNumber(addQuantity),
    });
    if (!parsed.success) {
      setAddErrors(zodFieldErrors(parsed.error));
      return;
    }
    setAddErrors({});

    const created = await send("POST", "/api/medications", parsed.data, setAddErrors);
    if (!created) return;

    applyRow(created);
    setAddName("");
    setAddSpecialistId("");
    setAddExpiry("");
    setAddDosage("");
    setAddQuantity("");
    setNotice({ tone: "success", text: `${created.name} added.` });
  }

  async function handleEdit(event: SubmitEvent<HTMLFormElement>, id: string) {
    event.preventDefault();

    const parsed = medicationDetailsSchema.safeParse({
      name: editName,
      specialist_id: editSpecialistId,
      expiry_date: editExpiry,
    });
    if (!parsed.success) {
      setPanelErrors(zodFieldErrors(parsed.error));
      return;
    }
    setPanelErrors({});

    const updated = await send("PATCH", `/api/medications/${id}`, parsed.data, setPanelErrors);
    if (!updated) return;

    applyRow(updated);
    closePanel();
    setNotice({ tone: "success", text: `${updated.name} updated.` });
  }

  /**
   * Shared by the dosage form and _Stop taking this_. A `daily_dosage` of 0 is
   * not a cleared field — it is the user recording that they have stopped, and
   * the row stays on the list saying so.
   */
  /**
   * `effectiveDate` is `undefined` when the user did not choose a date — either
   * they left the field alone, or they deliberately picked today.
   *
   * **Omitting it is still not the same as sending today.** An earlier version
   * of this note justified that by `setDosage` running its two-clock
   * compensating retry only for a server-derived date; that gate is gone
   * (impl-review F1) precisely because this page cannot reliably signal
   * "server-derived" across a UTC midnight. The reason that remains is simpler
   * and does not depend on the server's internals: a date sent explicitly is
   * floored against `utcToday`, and `utcToday` is frozen at page render. Letting
   * the server derive the day it is actually going to compare against is the
   * only version that cannot go stale in a long-lived tab.
   */
  async function submitDosage(id: string, dailyDosage: number, effectiveDate: string | undefined) {
    const scheduled = effectiveDate !== undefined;
    const updated = await send(
      "POST",
      `/api/medications/${id}/dosage`,
      { daily_dosage: dailyDosage, ...(scheduled ? { effective_date: effectiveDate } : {}) },
      setPanelErrors,
    );
    if (!updated) return;

    applyRow(updated);
    closePanel();
    setNotice({
      tone: "success",
      text: scheduled
        ? dailyDosage === 0
          ? `${updated.name} will stop on ${effectiveDate}. Its history is kept.`
          : `${updated.name} changes to ${String(dailyDosage)} per day on ${effectiveDate}.`
        : dailyDosage === 0
          ? `${updated.name} marked as not used. Its history is kept.`
          : `${updated.name} now at ${String(dailyDosage)} per day.`,
    });
  }

  /**
   * The one door into `submitDosage`, shared by the form and _Stop taking this_
   * so the button cannot disagree with the field it sits beside.
   *
   * The collision check is client-side, against the list already in props. It
   * can therefore be raced — two tabs, or a stale list — and the server's
   * behaviour in that case is to replace, unchanged. That is acceptable: this
   * confirm exists to catch a mistyped date, not to serialise concurrent edits.
   */
  function requestDosage(medication: MedicationView, dailyDosage: number) {
    // Built from the same UTC today the route floors against, so a date the
    // server would refuse never leaves the page.
    //
    // An untouched field is parsed as no date at all rather than as its seeded
    // value. Both halves of this matter: `utcToday` is the floor AND the seed,
    // so once the tab has outlived UTC midnight the seeded value is below its
    // own floor, and parsing it would fail an ordinary dosage change here —
    // before any request — with a field error on a date the user never chose.
    const parsed = dosageInputSchemaFor(utcToday).safeParse({
      daily_dosage: dailyDosage,
      effective_date: dosageDateTouched ? dosageDate : undefined,
    });
    if (!parsed.success) {
      setPanelErrors(zodFieldErrors(parsed.error));
      return;
    }
    setPanelErrors({});

    // Today is never a collision even though a row exists for it: replacing
    // today's dosage is this panel's original purpose and the hint already says
    // so. `pending_dosage_changes` is strictly future-dated, so an unchanged
    // field simply cannot match one — and an untouched one is already
    // `undefined` by the time it gets here, so the comparison below only ever
    // decides the case where the user deliberately picked today.
    const effectiveDate = parsed.data.effective_date === utcToday ? undefined : parsed.data.effective_date;
    const clash =
      effectiveDate === undefined
        ? undefined
        : medication.pending_dosage_changes.find((change) => change.effective_date === effectiveDate);

    if (clash) {
      setReplacePrompt({
        id: medication.id,
        name: medication.name,
        dailyDosage: parsed.data.daily_dosage,
        effectiveDate: clash.effective_date,
        replacing: clash.daily_dosage,
      });
      return;
    }

    void submitDosage(medication.id, parsed.data.daily_dosage, effectiveDate);
  }

  function handleDosage(event: SubmitEvent<HTMLFormElement>, medication: MedicationView) {
    event.preventDefault();
    requestDosage(medication, toNumber(dosageValue));
  }

  /**
   * Cancels one scheduled change. The route answers with the recalculated row,
   * so the figures revert in place rather than after a reload — and a 404 (the
   * row was already gone, or never the user's) lands in the panel as an error
   * notice like any other failure.
   */
  async function handleCancelChange(medication: MedicationView, effectiveDate: string) {
    const updated = await send(
      "DELETE",
      `/api/medications/${medication.id}/dosage/${effectiveDate}`,
      undefined,
      setPanelErrors,
    );
    if (!updated) return;

    applyRow(updated);
    setNotice({ tone: "success", text: `Scheduled change on ${effectiveDate} cancelled for ${updated.name}.` });
  }

  async function handleRefill(event: SubmitEvent<HTMLFormElement>, id: string) {
    event.preventDefault();

    const parsed = supplyInputSchema.safeParse({ kind: "refill", amount: toNumber(refillValue) });
    if (!parsed.success) {
      setPanelErrors(zodFieldErrors(parsed.error));
      return;
    }
    setPanelErrors({});

    const updated = await send("POST", `/api/medications/${id}/supply`, parsed.data, setPanelErrors);
    if (!updated) return;

    applyRow(updated);
    closePanel();
    setNotice({ tone: "success", text: `${updated.name} refilled — ${String(updated.projected_quantity)} on hand.` });
  }

  async function handleCorrect(event: SubmitEvent<HTMLFormElement>, id: string) {
    event.preventDefault();

    const parsed = supplyInputSchema.safeParse({ kind: "correction", counted: toNumber(countedValue) });
    if (!parsed.success) {
      setPanelErrors(zodFieldErrors(parsed.error));
      return;
    }
    setPanelErrors({});

    // A correction already at the counted figure writes nothing and still
    // answers 200 with the unchanged row, so this path does not special-case
    // it — the message states the resulting count either way.
    const projectedBefore = medications.find((row) => row.id === id)?.projected_quantity;
    const updated = await send("POST", `/api/medications/${id}/supply`, parsed.data, setPanelErrors);
    if (!updated) return;

    applyRow(updated);
    closePanel();
    setNotice({
      tone: "success",
      text: `${updated.name} corrected to ${String(updated.projected_quantity)} on hand${discrepancyPhrase(projectedBefore, updated.projected_quantity)}.`,
    });
  }

  async function handleArchive(medication: MedicationView, archived: boolean) {
    const updated = await send(
      "POST",
      `/api/medications/${medication.id}/archive`,
      { archived },
      // Nothing here maps onto a form field; the notice carries the message.
      () => undefined,
    );
    if (!updated) return;

    applyRow(updated);
    closePanel();
    setNotice({
      tone: "success",
      text: archived ? `${updated.name} archived.` : `${updated.name} restored.`,
    });

    // Archiving hides the row while "Show archived" is off, so the dialog's
    // trigger unmounts and Radix has nothing to restore focus to. Send it to
    // the toggle that brings the row back, after Radix has finished its own
    // restore.
    if (archived && !showArchived) {
      setTimeout(() => {
        document.getElementById("show-archived")?.focus();
      }, 0);
    }
  }

  return (
    <div className="space-y-8">
      {canAdd ? (
        <section aria-labelledby="add-medication-heading">
          <h2 id="add-medication-heading" className="text-foreground text-lg font-semibold">
            Add a medication
          </h2>
          <form onSubmit={handleAdd} className="mt-4 space-y-4" noValidate>
            <FormField
              id="medication-name"
              label="Name"
              value={addName}
              onChange={(value) => {
                setAddName(value);
                setAddErrors((previous) => ({ ...previous, name: "" }));
              }}
              placeholder="Metformin 500 mg"
              error={addErrors.name || undefined}
            />
            <SelectField
              id="medication-specialist"
              label="Specialist"
              value={addSpecialistId}
              onChange={(value) => {
                setAddSpecialistId(value);
                setAddErrors((previous) => ({ ...previous, specialist_id: "" }));
              }}
              options={specialistOptions(specialists)}
              placeholder="Choose a specialist"
              error={addErrors.specialist_id || undefined}
            />
            <FormField
              id="medication-expiry"
              label="Expiry date"
              type="date"
              value={addExpiry}
              onChange={(value) => {
                setAddExpiry(value);
                setAddErrors((previous) => ({ ...previous, expiry_date: "" }));
              }}
              error={addErrors.expiry_date || undefined}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="medication-dosage"
                label="Daily dosage"
                type="number"
                value={addDosage}
                onChange={(value) => {
                  setAddDosage(value);
                  setAddErrors((previous) => ({ ...previous, daily_dosage: "" }));
                }}
                placeholder="2"
                error={addErrors.daily_dosage || undefined}
              />
              <FormField
                id="medication-quantity"
                label="Quantity on hand"
                type="number"
                value={addQuantity}
                onChange={(value) => {
                  setAddQuantity(value);
                  setAddErrors((previous) => ({ ...previous, quantity: "" }));
                }}
                placeholder="30"
                error={addErrors.quantity || undefined}
              />
            </div>
            <Button type="submit" disabled={pending}>
              <Plus className="size-4" />
              Add medication
            </Button>
          </form>
        </section>
      ) : null}

      {/* Present on first paint so a change to any row is announced. */}
      <div aria-live="polite" className="min-h-5">
        {notice ? (
          <p className={notice.tone === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
            {notice.text}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="medication-list-heading">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="medication-list-heading" className="text-foreground text-lg font-semibold">
            Your medications
          </h2>
          <div className="flex items-center gap-2">
            <input
              id="show-archived"
              type="checkbox"
              checked={showArchived}
              onChange={(event) => {
                setShowArchived(event.target.checked);
              }}
              className="border-input accent-primary focus-visible:ring-ring/50 size-4 rounded-sm focus-visible:ring-[3px]"
            />
            <Label htmlFor="show-archived" className="text-muted-foreground">
              Show archived{archivedCount > 0 ? ` (${String(archivedCount)})` : ""}
            </Label>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            {/*
              An empty list after a failed read is not an empty list. Saying
              "no medications yet" there would state as fact the one thing the
              page could not establish, directly under the notice saying so.
            */}
            {loadFailed
              ? "Nothing could be loaded, so this list is not showing what you track. Reload the page to try again."
              : medications.length === 0
                ? "No medications yet. Add the first one above."
                : "Every medication you track is archived. Turn on “Show archived” to see them."}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {visible.map((medication) => {
              const open = panel?.id === medication.id ? panel.kind : null;
              const isArchived = medication.archived_at !== null;

              return (
                <li key={medication.id}>
                  <Card className="gap-4 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-foreground font-medium break-words">{medication.name}</p>
                        <p className="text-muted-foreground text-sm break-words">
                          {medication.specialist.name}
                          {medication.specialist.specialty ? ` · ${medication.specialist.specialty}` : ""}
                        </p>
                        <dl className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <div className="flex gap-1">
                            <dt>Dosage:</dt>
                            <dd className="text-foreground">{String(medication.current_dosage)} / day</dd>
                          </div>
                          <div className="flex gap-1">
                            <dt>On hand:</dt>
                            <dd className="text-foreground">{String(medication.projected_quantity)}</dd>
                          </div>
                          <div className="flex gap-1">
                            <dt>Expires:</dt>
                            <dd className="text-foreground">{medication.expiry_date}</dd>
                          </div>
                        </dl>
                      </div>

                      {/*
                        The word carries the meaning; colour is redundant. The
                        expired flag sits beside the status rather than inside
                        it — a medication can be expired AND in any state.
                      */}
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {/*
                          `not_started` names the day the dosage actually
                          begins, which is not necessarily the soonest pending
                          row — it can itself be 0/day. The rule is shared with
                          `deriveStatus`'s trigger and the dashboard's reason
                          line rather than re-derived here; see
                          `nextNonzeroPendingChange`. The map entry stays as the
                          fallback for the (structurally unreachable, but the
                          `Record` has to be total) case where none is found.
                        */}
                        <span className={STATUS_CLASS[medication.status]}>
                          {(() => {
                            if (medication.status !== "not_started") return STATUS_LABEL[medication.status];
                            const nextNonzero = nextNonzeroPendingChange(medication.pending_dosage_changes);
                            return nextNonzero
                              ? `Starts ${nextNonzero.effective_date}`
                              : STATUS_LABEL[medication.status];
                          })()}
                        </span>
                        {medication.is_expired ? <span className="text-destructive">Expired</span> : null}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        // Matches every other control: opening an editor while a
                        // request is in flight lets the resolving handler's
                        // `closePanel()` shut it again.
                        disabled={pending}
                        onClick={() => {
                          openPanel(medication, "edit");
                        }}
                      >
                        <Pencil className="size-4" />
                        Edit details
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          openPanel(medication, "dosage");
                        }}
                      >
                        <Gauge className="size-4" />
                        Change dosage
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          openPanel(medication, "refill");
                        }}
                      >
                        <Package className="size-4" />
                        Add refill
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          openPanel(medication, "correct");
                        }}
                      >
                        <Calculator className="size-4" />
                        Correct amount
                      </Button>

                      {isArchived ? (
                        // Restoring is not destructive, so it is not confirmed.
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending}
                          onClick={() => {
                            void handleArchive(medication, false);
                          }}
                        >
                          <ArchiveRestore className="size-4" />
                          Restore
                        </Button>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="destructive" disabled={pending}>
                              <Archive className="size-4" />
                              Archive
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Archive {medication.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                It leaves the list, but nothing is deleted — its dosage and supply history are kept, and
                                you can restore it from “Show archived”.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              {/* Destructive, never the green default: green means safe-to-proceed everywhere else in the app. */}
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => {
                                  void handleArchive(medication, true);
                                }}
                              >
                                Archive
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>

                    {open === "edit" ? (
                      <form
                        onSubmit={(event) => handleEdit(event, medication.id)}
                        className="border-border space-y-4 border-t pt-4"
                        noValidate
                        aria-label={`Edit ${medication.name}`}
                      >
                        <FormField
                          id={`edit-name-${medication.id}`}
                          label="Name"
                          value={editName}
                          onChange={(value) => {
                            setEditName(value);
                            setPanelErrors((previous) => ({ ...previous, name: "" }));
                          }}
                          error={panelErrors.name || undefined}
                        />
                        <SelectField
                          id={`edit-specialist-${medication.id}`}
                          label="Specialist"
                          value={editSpecialistId}
                          onChange={(value) => {
                            setEditSpecialistId(value);
                            setPanelErrors((previous) => ({ ...previous, specialist_id: "" }));
                          }}
                          options={specialistOptions(specialists)}
                          placeholder="Choose a specialist"
                          error={panelErrors.specialist_id || undefined}
                        />
                        <FormField
                          id={`edit-expiry-${medication.id}`}
                          label="Expiry date"
                          type="date"
                          value={editExpiry}
                          onChange={(value) => {
                            setEditExpiry(value);
                            setPanelErrors((previous) => ({ ...previous, expiry_date: "" }));
                          }}
                          error={panelErrors.expiry_date || undefined}
                        />
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button type="submit" disabled={pending}>
                            Save changes
                          </Button>
                          <Button type="button" variant="outline" onClick={closePanel}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : null}

                    {open === "dosage" ? (
                      <div className="border-border space-y-4 border-t pt-4">
                        {/*
                          A scheduled change the user cannot see is a change they
                          cannot undo: `dosage_changes` has no UPDATE policy, so
                          cancel-and-reschedule is the whole vocabulary. An empty
                          list renders nothing rather than an empty-state line —
                          most medications have no scheduled change and a "None"
                          row would be noise on every one of them.
                        */}
                        {medication.pending_dosage_changes.length > 0 ? (
                          <section aria-label={`Scheduled changes for ${medication.name}`}>
                            <h3 className="text-muted-foreground text-xs font-medium">Scheduled changes</h3>
                            <ul className="mt-2 space-y-2">
                              {medication.pending_dosage_changes.map((change) => (
                                <li
                                  key={change.effective_date}
                                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                                >
                                  <span className="text-foreground">
                                    {change.daily_dosage} / day from{" "}
                                    {/* The stored `YYYY-MM-DD` string, unformatted.
                                        Formatting means parsing it into a `Date`,
                                        which is how this screen would acquire an
                                        off-by-one-day bug. */}
                                    <time dateTime={change.effective_date}>{change.effective_date}</time>
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={pending}
                                    onClick={() => {
                                      void handleCancelChange(medication, change.effective_date);
                                    }}
                                  >
                                    Cancel this change
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ) : null}

                        <form
                          onSubmit={(event) => {
                            handleDosage(event, medication);
                          }}
                          className="space-y-4"
                          noValidate
                          aria-label={`Change the dosage of ${medication.name}`}
                        >
                          <FormField
                            id={`dosage-${medication.id}`}
                            label="Daily dosage"
                            type="number"
                            value={dosageValue}
                            onChange={(value) => {
                              setDosageValue(value);
                              setPanelErrors((previous) => ({ ...previous, daily_dosage: "" }));
                            }}
                            error={panelErrors.daily_dosage || undefined}
                          />
                          <FormField
                            id={`dosage-date-${medication.id}`}
                            label="Takes effect from"
                            type="date"
                            value={dosageDate}
                            min={utcToday}
                            onChange={(value) => {
                              setDosageDate(value);
                              setDosageDateTouched(true);
                              setPanelErrors((previous) => ({ ...previous, effective_date: "" }));
                            }}
                            error={panelErrors.effective_date || undefined}
                            hint={
                              <p className="text-muted-foreground mt-1 text-xs">
                                Left at today, this replaces today’s value rather than adding a second one. Set a later
                                date to schedule the change instead — the supply calculation uses the old dose up to
                                that day and the new one from it. Choosing a date that already has a scheduled change
                                asks before replacing it.
                              </p>
                            }
                          />
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button type="submit" disabled={pending}>
                              Save dosage
                            </Button>
                            {/* Recording 0 is a state, not an erasure — the row stays
                                listed. It goes through `requestDosage` so it honours
                                the date field above it: a scheduled stop is a real
                                thing to want, and a button that silently ignored the
                                date beside it would be lying. */}
                            <Button
                              type="button"
                              variant="outline"
                              disabled={pending}
                              onClick={() => {
                                requestDosage(medication, 0);
                              }}
                            >
                              Stop taking this
                            </Button>
                            <Button type="button" variant="outline" onClick={closePanel}>
                              Cancel
                            </Button>
                          </div>
                        </form>
                      </div>
                    ) : null}

                    {open === "refill" ? (
                      <form
                        onSubmit={(event) => handleRefill(event, medication.id)}
                        className="border-border space-y-4 border-t pt-4"
                        noValidate
                        aria-label={`Add a refill for ${medication.name}`}
                      >
                        <FormField
                          id={`refill-${medication.id}`}
                          label="Amount added"
                          type="number"
                          value={refillValue}
                          onChange={(value) => {
                            setRefillValue(value);
                            setPanelErrors((previous) => ({ ...previous, amount: "" }));
                          }}
                          placeholder="30"
                          error={panelErrors.amount || undefined}
                        />
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button type="submit" disabled={pending}>
                            Add refill
                          </Button>
                          <Button type="button" variant="outline" onClick={closePanel}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : null}

                    {open === "correct" ? (
                      <form
                        onSubmit={(event) => handleCorrect(event, medication.id)}
                        className="border-border space-y-4 border-t pt-4"
                        noValidate
                        aria-label={`Correct the amount of ${medication.name}`}
                      >
                        <FormField
                          id={`counted-${medication.id}`}
                          label="Amount you counted"
                          type="number"
                          value={countedValue}
                          onChange={(value) => {
                            setCountedValue(value);
                            setPanelErrors((previous) => ({ ...previous, counted: "" }));
                          }}
                          error={panelErrors.counted || undefined}
                          hint={
                            <p className="text-muted-foreground mt-1 text-xs">
                              The total you have now, not the difference. The correction is recorded as its own entry.
                            </p>
                          }
                        />
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button type="submit" disabled={pending}>
                            Save count
                          </Button>
                          <Button type="button" variant="outline" onClick={closePanel}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/*
        Rendered once for the whole list rather than per row, and CONTROLLED
        rather than trigger-driven like the Archive dialog: it opens from inside
        the submit path, not from a button press, so there is no element to hang
        an `AlertDialogTrigger` on. Radix still restores focus to whatever was
        focused when it opened — the Save dosage button, or the field the user
        pressed Enter in — which is the behaviour the Archive dialog gets from
        its trigger.

        Not `variant="destructive"` on the action: replacing a scheduled change
        is an ordinary edit the user came here to make, and `CLAUDE.md` →
        _Design conventions_ rations red to genuinely destructive moves. The
        confirm exists to catch a mistyped date, not to warn.
      */}
      <AlertDialog
        open={replacePrompt !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setReplacePrompt(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the change scheduled for {replacePrompt?.effectiveDate}?</AlertDialogTitle>
            <AlertDialogDescription>
              {replacePrompt
                ? `${replacePrompt.name} is already scheduled to change to ${String(replacePrompt.replacing)} / day on ${replacePrompt.effectiveDate}. Saving replaces it with ${String(replacePrompt.dailyDosage)} / day — one dosage is in force per day, so the existing change is removed rather than kept alongside.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the existing change</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!replacePrompt) return;
                const { id, dailyDosage, effectiveDate } = replacePrompt;
                setReplacePrompt(null);
                void submitDosage(id, dailyDosage, effectiveDate);
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
