import { useId } from "react";
import type { InputHTMLAttributes } from "react";

/** A labelled input with an optional hint and error, wired for assistive tech. */
export function Field({
  label,
  hint,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus-visible:border-slate-900 focus-visible:outline-none aria-invalid:border-red-600"
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
