import { useState, type ReactNode, type SubmitEvent } from "react";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { FormField } from "@/components/form/FormField";
import { SelectField } from "@/components/form/SelectField";
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
import type { ApiErrorBody } from "@/lib/api/json";
import { zodFieldErrors } from "@/lib/api/json";
import { isFarFuture, isPast } from "@/lib/dates";
import type { SpecialistWithUsage } from "@/lib/db/specialists";
import type { Visit } from "@/lib/db/visits";
import { visitInputSchema, type VisitInput } from "@/lib/validation/visit";

interface Props {
  /** Rendered server-side by `visits.astro`, so both lists paint with the page. */
  initialVisits: Visit[];
  /** Populates the select, and resolves each row's specialist name. */
  specialists: SpecialistWithUsage[];
  /**
   * The one "today" this screen has, resolved once in the user's stored zone by
   * the page. The island must never call `new Date()` for this: a second
   * "today" is exactly what would let the Upcoming/Past split and the past-date
   * hint disagree about the same row.
   */
  today: string;
}

type FieldErrors = Record<string, string>;

interface Notice {
  tone: "success" | "error";
  text: string;
}

/** Where a validated input is headed — a new row, or an existing one. */
type SaveTarget = { kind: "add" } | { kind: "edit"; id: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";
const ADD_FIELD_ID = "visit-specialist";

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
 * Both notes are advisory: a past date is a legitimate record of a visit that
 * happened, and a far-future one is far more likely a typo in the year than a
 * real appointment. Neither blocks the save, and neither is shown while a
 * validation error is — `FormField`'s hint slot already yields to `error`.
 */
function dateHint(value: string, today: string): ReactNode {
  if (!value) {
    return null;
  }
  if (isPast(value, today)) {
    return <p className="text-muted-foreground mt-1 text-xs">This date has already passed. You can still save it.</p>;
  }
  if (isFarFuture(value, today)) {
    return <p className="text-muted-foreground mt-1 text-xs">That is more than two years away — check the year.</p>;
  }
  return null;
}

export default function VisitsManager({ initialVisits, specialists, today }: Props) {
  const [visits, setVisits] = useState(initialVisits);
  const [addSpecialistId, setAddSpecialistId] = useState("");
  const [addDate, setAddDate] = useState("");
  const [addErrors, setAddErrors] = useState<FieldErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSpecialistId, setEditSpecialistId] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editErrors, setEditErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [duplicate, setDuplicate] = useState<{ input: VisitInput; target: SaveTarget } | null>(null);

  // Derived on every render from the single `visits` array rather than held as
  // two lists, so an edit that moves a row from Upcoming to Past — or a create
  // that lands in the middle — needs no bookkeeping of its own.
  const specialistById = new Map(specialists.map((specialist) => [specialist.id, specialist]));
  const options = specialists.map((specialist) => ({
    value: specialist.id,
    label: `${specialist.name} — ${specialist.specialty}`,
  }));
  const upcoming = visits
    .filter((visit) => !isPast(visit.visit_date, today))
    .sort((a, b) => a.visit_date.localeCompare(b.visit_date));
  const past = visits
    .filter((visit) => isPast(visit.visit_date, today))
    .sort((a, b) => b.visit_date.localeCompare(a.visit_date));

  function setErrorsFor(target: SaveTarget, errors: FieldErrors) {
    if (target.kind === "add") {
      setAddErrors(errors);
    } else {
      setEditErrors(errors);
    }
  }

  function specialistLabel(id: string) {
    // `visits_specialist_fk` is `ON DELETE RESTRICT`, so a visit's specialist
    // is always in this list. The fallback covers only a torn client state.
    return specialistById.get(id)?.name ?? "Unknown specialist";
  }

  async function save(input: VisitInput, target: SaveTarget) {
    setPending(true);

    try {
      const response = await fetch(target.kind === "add" ? "/api/visits" : `/api/visits/${target.id}`, {
        method: target.kind === "add" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await readApiError(response);
        setErrorsFor(target, error.fieldErrors ?? {});
        // A 404 on edit means the row is gone — deleted in another tab. Drop it
        // rather than leaving an editor open over something that isn't there.
        if (target.kind !== "add" && response.status === 404) {
          setVisits((previous) => previous.filter((row) => row.id !== target.id));
          setEditingId(null);
        }
        setNotice({ tone: "error", text: error.message });
        return;
      }

      const saved = (await response.json()) as Visit;
      setVisits((previous) =>
        target.kind === "add" ? [...previous, saved] : previous.map((row) => (row.id === saved.id ? saved : row)),
      );

      if (target.kind === "add") {
        setAddSpecialistId("");
        setAddDate("");
      } else {
        setEditingId(null);
      }
      setNotice({
        tone: "success",
        text: `Visit with ${specialistLabel(saved.specialist_id)} on ${saved.visit_date} ${
          target.kind === "add" ? "added" : "updated"
        }.`,
      });
    } catch {
      setNotice({ tone: "error", text: GENERIC_ERROR });
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>, target: SaveTarget) {
    event.preventDefault();
    setNotice(null);

    // The same schema the route validates with, so a value the server would
    // reject never leaves the page.
    const parsed = visitInputSchema.safeParse(
      target.kind === "add"
        ? { specialist_id: addSpecialistId, visit_date: addDate }
        : { specialist_id: editSpecialistId, visit_date: editDate },
    );
    if (!parsed.success) {
      setErrorsFor(target, zodFieldErrors(parsed.error));
      return;
    }
    setErrorsFor(target, {});

    // Duplicates are legal at every layer below this line: there is no unique
    // constraint and the API accepts a duplicate posted directly. This dialog
    // is a courtesy against a double submit, not an invariant — do not read it
    // as one.
    const clash = visits.find(
      (row) =>
        row.specialist_id === parsed.data.specialist_id &&
        row.visit_date === parsed.data.visit_date &&
        !(target.kind === "edit" && row.id === target.id),
    );
    if (clash) {
      setDuplicate({ input: parsed.data, target });
      return;
    }

    await save(parsed.data, target);
  }

  function startEdit(visit: Visit) {
    setNotice(null);
    setEditErrors({});
    setEditingId(visit.id);
    setEditSpecialistId(visit.specialist_id);
    setEditDate(visit.visit_date);
  }

  async function handleDelete(visit: Visit) {
    setNotice(null);
    setPending(true);

    try {
      const response = await fetch(`/api/visits/${visit.id}`, { method: "DELETE" });

      // Nothing references a visit, so there is no 409 branch here — a 404 is
      // the only expected failure, and it means the row is already gone.
      if (!response.ok) {
        const error = await readApiError(response);
        if (response.status === 404) {
          setVisits((previous) => previous.filter((row) => row.id !== visit.id));
        }
        setNotice({ tone: "error", text: error.message });
        return;
      }

      setVisits((previous) => previous.filter((row) => row.id !== visit.id));
      setNotice({
        tone: "success",
        text: `Visit with ${specialistLabel(visit.specialist_id)} on ${visit.visit_date} deleted.`,
      });

      // The dialog's trigger unmounts with the row, so Radix has nothing to
      // restore focus to. Send it to the add form instead of the document body,
      // after Radix has finished its own restore.
      setTimeout(() => {
        document.getElementById(ADD_FIELD_ID)?.focus();
      }, 0);
    } catch {
      setNotice({ tone: "error", text: GENERIC_ERROR });
    } finally {
      setPending(false);
    }
  }

  function renderVisit(visit: Visit) {
    const specialist = specialistById.get(visit.specialist_id);

    return (
      <li key={visit.id}>
        <Card className="gap-0 p-4">
          {editingId === visit.id ? (
            <form
              onSubmit={(event) => handleSubmit(event, { kind: "edit", id: visit.id })}
              className="space-y-4"
              noValidate
              aria-label={`Edit visit on ${visit.visit_date}`}
            >
              <SelectField
                id={`edit-specialist-${visit.id}`}
                label="Specialist"
                value={editSpecialistId}
                onChange={(value) => {
                  setEditSpecialistId(value);
                  setEditErrors((previous) => ({ ...previous, specialist_id: "" }));
                }}
                options={options}
                placeholder="Choose a specialist"
                error={editErrors.specialist_id || undefined}
              />
              <FormField
                id={`edit-date-${visit.id}`}
                type="date"
                label="Date"
                value={editDate}
                onChange={(value) => {
                  setEditDate(value);
                  setEditErrors((previous) => ({ ...previous, visit_date: "" }));
                }}
                error={editErrors.visit_date || undefined}
                hint={dateHint(editDate, today)}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" disabled={pending}>
                  Save changes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingId(null);
                    setEditErrors({});
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                {/* The date is rendered as the ISO string it is stored as.
                    Formatting it would mean parsing it into a `Date`, which is
                    how this screen would acquire an off-by-one-day bug. */}
                <p className="text-foreground font-medium">
                  <time dateTime={visit.visit_date}>{visit.visit_date}</time>
                </p>
                <p className="text-muted-foreground text-sm break-words">
                  {specialist ? `${specialist.name} — ${specialist.specialty}` : "Unknown specialist"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    startEdit(visit);
                  }}
                >
                  <Pencil className="size-4" />
                  Edit
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" disabled={pending}>
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this visit?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {`The visit with ${specialistLabel(visit.specialist_id)} on ${visit.visit_date} will be removed. This cannot be undone.`}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      {/* Destructive, never the green default: green means safe-to-proceed everywhere else in the app. */}
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => {
                          void handleDelete(visit);
                        }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </Card>
      </li>
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="add-visit-heading">
        <h2 id="add-visit-heading" className="text-foreground text-lg font-semibold">
          Add a visit
        </h2>

        {specialists.length === 0 ? (
          // A select with no options can only produce a submit that fails, so
          // the form is replaced by the thing the user has to do first.
          <p className="text-muted-foreground mt-4 text-sm">
            You have no specialists yet, and every visit is booked with one.{" "}
            <a href="/specialists" className="text-primary rounded-sm underline">
              Add a specialist
            </a>{" "}
            first, then come back here.
          </p>
        ) : (
          <form
            onSubmit={(event) => handleSubmit(event, { kind: "add" })}
            className="mt-4 space-y-4"
            noValidate
            aria-label="Add a visit"
          >
            <SelectField
              id={ADD_FIELD_ID}
              label="Specialist"
              value={addSpecialistId}
              onChange={(value) => {
                setAddSpecialistId(value);
                setAddErrors((previous) => ({ ...previous, specialist_id: "" }));
              }}
              options={options}
              placeholder="Choose a specialist"
              error={addErrors.specialist_id || undefined}
            />
            <FormField
              id="visit-date"
              type="date"
              label="Date"
              value={addDate}
              onChange={(value) => {
                setAddDate(value);
                setAddErrors((previous) => ({ ...previous, visit_date: "" }));
              }}
              error={addErrors.visit_date || undefined}
              hint={dateHint(addDate, today)}
            />
            <Button type="submit" disabled={pending}>
              <CalendarPlus className="size-4" />
              Add visit
            </Button>
          </form>
        )}
      </section>

      {/* Present on first paint so an added, edited or deleted row is announced. */}
      <div aria-live="polite" className="min-h-5">
        {notice ? (
          <p className={notice.tone === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
            {notice.text}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="upcoming-visits-heading">
        <h2 id="upcoming-visits-heading" className="text-foreground text-lg font-semibold">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">No upcoming visits.</p>
        ) : (
          <ul className="mt-4 space-y-3">{upcoming.map(renderVisit)}</ul>
        )}
      </section>

      <section aria-labelledby="past-visits-heading">
        <h2 id="past-visits-heading" className="text-foreground text-lg font-semibold">
          Past
        </h2>
        {past.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">No past visits.</p>
        ) : (
          <ul className="mt-4 space-y-3">{past.map(renderVisit)}</ul>
        )}
      </section>

      {/* Controlled, because it opens from a submit rather than from a trigger
          the user clicks. It gates nothing server-side. */}
      <AlertDialog
        open={duplicate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDuplicate(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You already have this visit</AlertDialogTitle>
            <AlertDialogDescription>
              {duplicate
                ? `A visit with ${specialistLabel(duplicate.input.specialist_id)} on ${duplicate.input.visit_date} is already in your list. Save this one as well?`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (duplicate) {
                  const confirmed = duplicate;
                  setDuplicate(null);
                  void save(confirmed.input, confirmed.target);
                }
              }}
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
