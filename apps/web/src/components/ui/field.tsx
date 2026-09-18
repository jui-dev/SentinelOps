import { CircleAlert } from "lucide-react";
import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

import { cx } from "./cx";

export type ControlSize = "md" | "lg";

/**
 * The look shared by every text-like control — inputs and selects. A 1px
 * border at 3:1 against its background, so the control is findable without
 * relying on anything else (WCAG 1.4.11).
 */
export const controlClasses = (
  size: ControlSize | "multiline" = "md",
) =>
  cx(
    "w-full min-w-0 rounded-md border border-line-control bg-field text-fg transition-colors duration-(--duration-fast)",
    "placeholder:text-fg-subtle hover:border-fg-subtle",
    "focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus",
    "aria-invalid:border-danger-solid",
    // The attribute, not `:read-only`, which also matches every <select>.
    "[&[readonly]]:border-line [&[readonly]]:bg-sunken [&[readonly]]:text-fg-muted",
    "disabled:cursor-not-allowed disabled:border-line disabled:text-fg-disabled",
    size === "multiline"
      ? "min-h-24 px-2.5 py-1.5 text-base leading-6"
      : size === "lg"
        ? "h-9 px-3 text-base"
        : "h-8 px-2.5 text-base",
  );

/**
 * Label, control, hint, and error for one form field, wired together for
 * assistive technology. Shared by Field and Select.
 */
export function FieldFrame({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-baseline gap-2 text-sm font-medium text-fg"
      >
        {label}
        {optional && (
          <span className="text-xs font-normal text-fg-subtle">Optional</span>
        )}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          className="flex items-start gap-1.5 text-xs text-danger-text"
        >
          <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Ids for a field's hint and error, for `aria-describedby`. */
export const describedBy = (
  id: string,
  hint?: string,
  error?: string,
): string | undefined =>
  [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") ||
  undefined;

/**
 * A labelled multi-line text control, for prose longer than a line — an
 * incident's summary. The same frame and control look as Field; it grows
 * vertically only.
 */
export function TextArea({
  label,
  hint,
  error,
  optional,
  className,
  ...textarea
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
}) {
  const id = useId();

  return (
    <FieldFrame
      id={id}
      label={label}
      optional={optional}
      hint={hint}
      error={error}
    >
      <textarea
        id={id}
        rows={4}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cx(controlClasses("multiline"), "resize-y", className)}
        {...textarea}
      />
    </FieldFrame>
  );
}

/** A labelled input with an optional hint and error, wired for assistive tech. */
export function Field({
  label,
  hint,
  error,
  optional,
  size = "md",
  className,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: string;
  hint?: string;
  error?: string;
  /** Marks the field optional in its label. Required is the default. */
  optional?: boolean;
  size?: ControlSize;
}) {
  const id = useId();

  return (
    <FieldFrame
      id={id}
      label={label}
      optional={optional}
      hint={hint}
      error={error}
    >
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cx(controlClasses(size), className)}
        {...input}
      />
    </FieldFrame>
  );
}
