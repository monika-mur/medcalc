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
  error,
  hint,
  icon,
  endContent,
}: FormFieldProps) {
  const errorId = `${id}-error`;

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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
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
      ) : (
        hint
      )}
    </div>
  );
}
