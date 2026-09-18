import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { SelectHTMLAttributes } from "react";

import { cx } from "./cx";
import { controlClasses, describedBy, FieldFrame } from "./field";
import type { ControlSize } from "./field";

/**
 * A native <select>, styled as a control. Native on purpose: keyboard,
 * screen-reader, and mobile behaviour come free, and its option list follows
 * `color-scheme` in both themes.
 */
export function SelectControl({
  size = "md",
  className,
  ...select
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  size?: ControlSize;
}) {
  return (
    <div className={cx("relative", className)}>
      <select
        className={cx(controlClasses(size), "appearance-none pr-8")}
        {...select}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-fg-subtle"
      />
    </div>
  );
}

/** A labelled select with an optional hint and error. */
export function Select({
  label,
  hint,
  error,
  ...select
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  label: string;
  hint?: string;
  error?: string;
  size?: ControlSize;
}) {
  const id = useId();

  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <SelectControl
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...select}
      />
    </FieldFrame>
  );
}
