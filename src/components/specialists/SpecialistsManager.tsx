import { useState, type SubmitEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import type { ApiErrorBody } from "@/lib/api/json";
import { zodFieldErrors } from "@/lib/api/json";
import type { Specialist, SpecialistWithUsage } from "@/lib/db/specialists";
import { specialistInputSchema } from "@/lib/validation/specialist";

interface Props {
  /** Rendered server-side by `specialists.astro`, so the list paints with the page. */
  initialSpecialists: SpecialistWithUsage[];
}

type FieldErrors = Record<string, string>;

interface Notice {
  tone: "success" | "error";
  text: string;
}

const GENERIC_ERROR = "Something went wrong. Please try again.";

/** The list is ordered by name server-side; keep local edits in the same order. */
function byName(a: SpecialistWithUsage, b: SpecialistWithUsage) {
  return a.name.localeCompare(b.name);
}

function usageReason(count: number) {
  const plural = count === 1 ? "" : "s";
  return `In use by ${count} medication${plural} or visit${plural}. Reassign or remove those first.`;
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

export default function SpecialistsManager({ initialSpecialists }: Props) {
  const [specialists, setSpecialists] = useState(initialSpecialists);
  const [addName, setAddName] = useState("");
  const [addSpecialty, setAddSpecialty] = useState("");
  const [addErrors, setAddErrors] = useState<FieldErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSpecialty, setEditSpecialty] = useState("");
  const [editErrors, setEditErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleAdd(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    // The same schema the route validates with, so a value the server would
    // reject never leaves the page.
    const parsed = specialistInputSchema.safeParse({ name: addName, specialty: addSpecialty });
    if (!parsed.success) {
      setAddErrors(zodFieldErrors(parsed.error));
      return;
    }
    setAddErrors({});
    setPending(true);

    try {
      const response = await fetch("/api/specialists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        const error = await readApiError(response);
        setAddErrors(error.fieldErrors ?? {});
        setNotice({ tone: "error", text: error.message });
        return;
      }
      const created = (await response.json()) as Specialist;
      // Nothing can reference a specialist that did not exist a moment ago.
      setSpecialists((previous) => [...previous, { ...created, usageCount: 0 }].sort(byName));
      setAddName("");
      setAddSpecialty("");
      setNotice({ tone: "success", text: `${created.name} added.` });
    } catch {
      setNotice({ tone: "error", text: GENERIC_ERROR });
    } finally {
      setPending(false);
    }
  }

  function startEdit(specialist: SpecialistWithUsage) {
    setNotice(null);
    setEditErrors({});
    setEditingId(specialist.id);
    setEditName(specialist.name);
    setEditSpecialty(specialist.specialty);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditErrors({});
  }

  async function handleEdit(event: SubmitEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setNotice(null);

    const parsed = specialistInputSchema.safeParse({ name: editName, specialty: editSpecialty });
    if (!parsed.success) {
      setEditErrors(zodFieldErrors(parsed.error));
      return;
    }
    setEditErrors({});
    setPending(true);

    try {
      const response = await fetch(`/api/specialists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        const error = await readApiError(response);
        setEditErrors(error.fieldErrors ?? {});
        setNotice({ tone: "error", text: error.message });
        return;
      }
      const updated = (await response.json()) as Specialist;
      // Spread the row first so `usageCount` — which the route does not return
      // — survives the update.
      setSpecialists((previous) =>
        previous.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)).sort(byName),
      );
      setEditingId(null);
      setNotice({ tone: "success", text: `${updated.name} updated.` });
    } catch {
      setNotice({ tone: "error", text: GENERIC_ERROR });
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(specialist: SpecialistWithUsage) {
    setNotice(null);
    setPending(true);

    try {
      const response = await fetch(`/api/specialists/${specialist.id}`, { method: "DELETE" });

      // The usage count was read when the page rendered. A medication assigned
      // in another tab since then is exactly what the 409 exists to catch, so
      // fold the answer back into the row rather than only reporting it.
      if (response.status === 409) {
        const error = await readApiError(response);
        setSpecialists((previous) =>
          previous.map((row) => (row.id === specialist.id ? { ...row, usageCount: Math.max(row.usageCount, 1) } : row)),
        );
        setNotice({ tone: "error", text: error.message });
        return;
      }

      if (!response.ok) {
        const error = await readApiError(response);
        if (response.status === 404) {
          setSpecialists((previous) => previous.filter((row) => row.id !== specialist.id));
        }
        setNotice({ tone: "error", text: error.message });
        return;
      }

      setSpecialists((previous) => previous.filter((row) => row.id !== specialist.id));
      setNotice({ tone: "success", text: `${specialist.name} deleted.` });

      // The dialog's trigger unmounts with the row, so Radix has nothing to
      // restore focus to. Send it to the add form instead of the document body,
      // after Radix has finished its own restore.
      setTimeout(() => {
        document.getElementById("specialist-name")?.focus();
      }, 0);
    } catch {
      setNotice({ tone: "error", text: GENERIC_ERROR });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="add-specialist-heading">
        <h2 id="add-specialist-heading" className="text-foreground text-lg font-semibold">
          Add a specialist
        </h2>
        <form onSubmit={handleAdd} className="mt-4 space-y-4" noValidate>
          <FormField
            id="specialist-name"
            label="Name"
            value={addName}
            onChange={(value) => {
              setAddName(value);
              setAddErrors((previous) => ({ ...previous, name: "" }));
            }}
            placeholder="Dr. Anna Nowak"
            error={addErrors.name || undefined}
          />
          <FormField
            id="specialist-specialty"
            label="Specialty"
            value={addSpecialty}
            onChange={(value) => {
              setAddSpecialty(value);
              setAddErrors((previous) => ({ ...previous, specialty: "" }));
            }}
            placeholder="Cardiology"
            error={addErrors.specialty || undefined}
          />
          <Button type="submit" disabled={pending}>
            <Plus className="size-4" />
            Add specialist
          </Button>
        </form>
      </section>

      {/* Present on first paint so an added or deleted row is announced. */}
      <div aria-live="polite" className="min-h-5">
        {notice ? (
          <p className={notice.tone === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
            {notice.text}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="specialist-list-heading">
        <h2 id="specialist-list-heading" className="text-foreground text-lg font-semibold">
          Your specialists
        </h2>

        {specialists.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            No specialists yet. Add the first one above — medications and visits are assigned to a specialist.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {specialists.map((specialist) => {
              const reasonId = `delete-reason-${specialist.id}`;
              const inUse = specialist.usageCount > 0;

              return (
                <li key={specialist.id}>
                  <Card className="gap-0 p-4">
                    {editingId === specialist.id ? (
                      <form
                        onSubmit={(event) => handleEdit(event, specialist.id)}
                        className="space-y-4"
                        noValidate
                        aria-label={`Edit ${specialist.name}`}
                      >
                        <FormField
                          id={`edit-name-${specialist.id}`}
                          label="Name"
                          value={editName}
                          onChange={(value) => {
                            setEditName(value);
                            setEditErrors((previous) => ({ ...previous, name: "" }));
                          }}
                          error={editErrors.name || undefined}
                        />
                        <FormField
                          id={`edit-specialty-${specialist.id}`}
                          label="Specialty"
                          value={editSpecialty}
                          onChange={(value) => {
                            setEditSpecialty(value);
                            setEditErrors((previous) => ({ ...previous, specialty: "" }));
                          }}
                          error={editErrors.specialty || undefined}
                        />
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button type="submit" disabled={pending}>
                            Save changes
                          </Button>
                          <Button type="button" variant="outline" onClick={cancelEdit}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-foreground font-medium break-words">{specialist.name}</p>
                          <p className="text-muted-foreground text-sm break-words">{specialist.specialty}</p>
                        </div>

                        <div className="flex flex-col gap-2 sm:items-end">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                startEdit(specialist);
                              }}
                            >
                              <Pencil className="size-4" />
                              Edit
                            </Button>

                            {inUse ? (
                              // Disabled because the database would refuse it
                              // anyway — the FK is `ON DELETE RESTRICT`.
                              <Button type="button" variant="destructive" disabled aria-describedby={reasonId}>
                                <Trash2 className="size-4" />
                                Delete
                              </Button>
                            ) : (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button type="button" variant="destructive" disabled={pending}>
                                    <Trash2 className="size-4" />
                                    Delete
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete {specialist.name}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Nothing is assigned to this specialist, so deleting is safe — but it cannot be
                                      undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    {/* Destructive, never the green default: green means safe-to-proceed everywhere else in the app. */}
                                    <AlertDialogAction
                                      variant="destructive"
                                      onClick={() => {
                                        void handleDelete(specialist);
                                      }}
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>

                          {/* Rendered as text, not a `title` tooltip: a tooltip is
                              invisible on touch and to screen readers, and this is
                              the only explanation for a control that does nothing. */}
                          {inUse ? (
                            <p id={reasonId} className="text-muted-foreground text-xs sm:text-right">
                              {usageReason(specialist.usageCount)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    )}
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
