import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  id: string;
  name?: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Forwarded verbatim to the input. Only meaningful for the types that order
   * their values — `date` and `number` — and optional because this control is
   * shared with the specialists and visits islands, which pass neither.
   *
   * On a `date` field this is what stops the picker offering a day the server
   * would refuse. It is a convenience, never the guard: the schema and the RLS
   * policy are, and a typed-in value bypasses `min` entirely.
   */
  min?: string;
  error?: string;
  hint?: ReactNode;
  /** Optional: auth fields carry one, domain fields generally do not. */
  icon?: ReactNode;
  endContent?: ReactNode;
}

export function FormField({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  min,
  error,
  hint,
  icon,
  endContent,
}: FormFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  // Whichever of the two is showing is the one described. A hint that is
  // rendered but never referenced is visual-only and silent to a screen
  // reader, which is what this pointed at before S-03 gave the hint an id.
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div>
      <Label htmlFor={id} className="text-muted-foreground mb-1.5">
        {label}
      </Label>
      <div className="relative">
        {icon ? (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2">
            {icon}
          </span>
        ) : null}
        <Input
          id={id}
          name={name ?? id}
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          min={min}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(icon && "pl-10", endContent && "pr-10")}
        />
        {endContent}
      </div>
      {/*
        The message is what conveys the error — the red border is a redundant
        cue, never the only one. Colour alone fails the accessibility criterion
        this phase carries.
      */}
      {error ? (
        <p id={errorId} className="text-destructive mt-1 flex items-center gap-1 text-xs">
          <CircleAlert className="size-3 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <div id={hintId}>{hint}</div>
      ) : null}
    </div>
  );
}
