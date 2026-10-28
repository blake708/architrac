import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";
import { ChevronDownIcon } from "./icons";

/** Shared look for Input, Select and Textarea. */
export const controlClasses = cn(
  "w-full rounded-sm border border-line-input bg-surface px-2.5 text-base text-ink placeholder:text-faint",
  "focus:outline-2 focus:-outline-offset-1 focus:outline-blue",
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-faint",
  "aria-[invalid=true]:border-red",
);

type FieldProps = {
  /** Caption shown above the control. */
  label?: ReactNode;
  /** Help text shown below (hidden while there's an error). */
  hint?: ReactNode;
  /** Error message shown below in red; also marks the control invalid. */
  error?: ReactNode;
  /** Classes for the wrapper around label + control + message. */
  wrapperClassName?: string;
};

function FieldShell({
  id,
  label,
  hint,
  error,
  wrapperClassName,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      {label && (
        <label htmlFor={id} className="cap text-xs font-medium text-muted">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="m-0 text-xs text-red">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="m-0 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** aria props that connect a control to its error or hint text. */
function describedBy(id: string, { error, hint }: FieldProps) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

export function Input({
  label,
  hint,
  error,
  wrapperClassName,
  id,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      wrapperClassName={wrapperClassName}
    >
      <input
        id={fieldId}
        className={cn(controlClasses, "h-[var(--height-control)]", className)}
        {...describedBy(fieldId, { error, hint })}
        {...props}
      />
    </FieldShell>
  );
}

/** A native <select> (best for keyboards, screen readers and phones), styled to match. */
export function Select({
  label,
  hint,
  error,
  wrapperClassName,
  id,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      wrapperClassName={wrapperClassName}
    >
      <div className="relative">
        <select
          id={fieldId}
          className={cn(
            controlClasses,
            "h-[var(--height-control)] cursor-pointer appearance-none pr-8",
            className,
          )}
          {...describedBy(fieldId, { error, hint })}
          {...props}
        >
          {children}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted" />
      </div>
    </FieldShell>
  );
}

export function Textarea({
  label,
  hint,
  error,
  wrapperClassName,
  id,
  className,
  rows = 4,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      wrapperClassName={wrapperClassName}
    >
      <textarea
        id={fieldId}
        rows={rows}
        className={cn(
          controlClasses,
          "min-h-[var(--height-control)] py-2",
          className,
        )}
        {...describedBy(fieldId, { error, hint })}
        {...props}
      />
    </FieldShell>
  );
}
