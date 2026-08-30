import { useState, type SubmitEvent } from "react";
import { Archive, ArchiveRestore, Calculator, CircleAlert, Gauge, Package, Pencil, Plus } from "lucide-react";
import { FormField } from "@/components/form/FormField";
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
import type { MedicationStatus, MedicationView } from "@/lib/db/medications";
import type { SpecialistWithUsage } from "@/lib/db/specialists";
import {
  dosageInputSchema,
  medicationCreateSchema,
  medicationDetailsSchema,
  supplyInputSchema,
} from "@/lib/validation/medication";

interface Props {
  /** Rendered server-side by `medications.astro`, so the list paints with the page. */
  initialMedications: MedicationView[];
  /** `specialist_id` is `not null`, so an empty list means no medication can be added. */
  specialists: SpecialistWithUsage[];
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
 * one. Green is rationed to `active` and red to `out_of_stock`; the other two
 * are neutral because they are states the user chose, not warnings. There is no
 * amber token in `:root`, and this slice deliberately does not invent one: the
 * green/yellow/red supply scale belongs to S-04.
 */
const STATUS_LABEL: Record<MedicationStatus, string> = {
  active: "Active",
  not_used: "Not used",
  out_of_stock: "Out of stock",
  archived: "Archived",
};

const STATUS_CLASS: Record<MedicationStatus, string> = {
  active: "text-primary",
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

interface SpecialistSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  specialists: SpecialistWithUsage[];
}

/**
 * A native `<select>` styled to match `Input`, kept local to this file on
 * purpose: S-03 introduces a shared `SelectField` in a sibling worktree, and
 * both branches creating the same new file would be a create/create conflict.
 * The second merger swaps this for that component — see the plan's
 * _Parallel-slice coordination_.
 */
function SpecialistSelect({ id, value, onChange, error, specialists }: SpecialistSelectProps) {
  const errorId = `${id}-error`;

  return (
    <div>
      <Label htmlFor={id} className="text-muted-foreground mb-1.5">
        Specialist
      </Label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
      >
        <option value="">Choose a specialist</option>
        {specialists.map((specialist) => (
          <option key={specialist.id} value={specialist.id}>
            {specialist.name} — {specialist.specialty}
          </option>
        ))}
      </select>
      {/*
        The message is what conveys the error — the red border is a redundant
        cue, never the only one. Mirrors `FormField`, which this control cannot
        reuse because that component renders an `<input>`.
      */}
      {error ? (
        <p id={errorId} className="text-destructive mt-1 flex items-center gap-1 text-xs">
          <CircleAlert className="size-3 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function MedicationsManager({ initialMedications, specialists }: Props) {
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
  const [refillValue, setRefillValue] = useState("");
  const [countedValue, setCountedValue] = useState("");

  const canAdd = specialists.length > 0;
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
    method: "POST" | "PATCH",
    url: string,
    body: unknown,
    setErrors: (errors: FieldErrors) => void,
  ): Promise<MedicationView | null> {
    setNotice(null);
    setPending(true);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    } else if (kind === "refill") {
      setRefillValue("");
    } else {
      setCountedValue(String(medication.quantity_on_hand));
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
  async function submitDosage(id: string, dailyDosage: number) {
    const updated = await send("POST", `/api/medications/${id}/dosage`, { daily_dosage: dailyDosage }, setPanelErrors);
    if (!updated) return;

    applyRow(updated);
    closePanel();
    setNotice({
      tone: "success",
      text:
        dailyDosage === 0
          ? `${updated.name} marked as not used. Its history is kept.`
          : `${updated.name} now at ${String(dailyDosage)} per day.`,
    });
  }

  async function handleDosage(event: SubmitEvent<HTMLFormElement>, id: string) {
    event.preventDefault();

    const parsed = dosageInputSchema.safeParse({ daily_dosage: toNumber(dosageValue) });
    if (!parsed.success) {
      setPanelErrors(zodFieldErrors(parsed.error));
      return;
    }
    setPanelErrors({});
    await submitDosage(id, parsed.data.daily_dosage);
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
    setNotice({ tone: "success", text: `${updated.name} refilled — ${String(updated.quantity_on_hand)} on hand.` });
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
    const updated = await send("POST", `/api/medications/${id}/supply`, parsed.data, setPanelErrors);
    if (!updated) return;

    applyRow(updated);
    closePanel();
    setNotice({ tone: "success", text: `${updated.name} corrected to ${String(updated.quantity_on_hand)} on hand.` });
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
            <SpecialistSelect
              id="medication-specialist"
              value={addSpecialistId}
              onChange={(value) => {
                setAddSpecialistId(value);
                setAddErrors((previous) => ({ ...previous, specialist_id: "" }));
              }}
              error={addErrors.specialist_id || undefined}
              specialists={specialists}
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
            {medications.length === 0
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
                            <dd className="text-foreground">{String(medication.quantity_on_hand)}</dd>
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
                        <span className={STATUS_CLASS[medication.status]}>{STATUS_LABEL[medication.status]}</span>
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
                        <SpecialistSelect
                          id={`edit-specialist-${medication.id}`}
                          value={editSpecialistId}
                          onChange={(value) => {
                            setEditSpecialistId(value);
                            setPanelErrors((previous) => ({ ...previous, specialist_id: "" }));
                          }}
                          error={panelErrors.specialist_id || undefined}
                          specialists={specialists}
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
                      <form
                        onSubmit={(event) => handleDosage(event, medication.id)}
                        className="border-border space-y-4 border-t pt-4"
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
                          hint={
                            <p className="text-muted-foreground mt-1 text-xs">
                              Takes effect today. Setting it again today replaces today’s value rather than adding a
                              second one.
                            </p>
                          }
                        />
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button type="submit" disabled={pending}>
                            Save dosage
                          </Button>
                          {/* Recording 0 is a state, not an erasure — the row stays listed. */}
                          <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={() => {
                              void submitDosage(medication.id, 0);
                            }}
                          >
                            Stop taking this
                          </Button>
                          <Button type="button" variant="outline" onClick={closePanel}>
                            Cancel
                          </Button>
                        </div>
                      </form>
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
    </div>
  );
}
