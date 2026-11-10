"use client";

import { Info } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

/**
 * Required fields, said the same way on every form: a red asterisk after
 * the label (the control's own `required` is what assistive technology
 * hears), a "* Required" note once per form, and the form's main button
 * held back until every required field has something in it — with the
 * reason beside it, since a disabled button cannot say why on its own.
 *
 * Advice, as every client check is: the API validates regardless, and its
 * answers still show against each field.
 */

/** The asterisk after a required field's label. Decorative: `required` speaks. */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="font-semibold text-danger-text">
      *
    </span>
  );
}

/** Said once per form, where its fields begin or in its header. */
export function RequiredNote({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-xs text-fg-subtle"}>
      <RequiredMark /> Required
    </p>
  );
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** A control's label, as the reader sees it, without its marks. */
const labelOf = (control: Control): string => {
  const label = control.labels?.[0]?.textContent ?? control.name;

  return label.replace(/\*/g, "").replace(/Optional/g, "").trim();
};

/** Which required controls in the form are still empty, by their labels. */
const missingIn = (form: HTMLFormElement): string[] =>
  Array.from(
    form.querySelectorAll<Control>(
      "input[required], textarea[required], select[required]",
    ),
  )
    .filter((control) => !control.disabled && control.value.trim() === "")
    .map(labelOf);

/** "Name", "Name and Email", "Name, Email and Password". */
const listOf = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Watches a form's required fields. Give `attach` to the <form> as its
 * ref; disable its main button while `ready` is false, pointing it at
 * `hintId`, and render `<SubmitHint>` beside it.
 *
 * It reads the form itself — every `required` control, whatever renders
 * it — so a form opts in with `attach` and nothing else, and a field that
 * appears later is counted as soon as it does.
 *
 * A value set from code fires no event — a controlled field filled by a
 * button, as Generate fills a password. Pass that value as `watched`, and
 * the form is read again whenever it changes.
 */
export function useRequiredFields(watched?: unknown) {
  const hintId = useId();
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const attach = useCallback(
    (node: HTMLFormElement | null) => setForm(node),
    [],
  );

  useEffect(() => {
    if (!form) return;

    const update = () => {
      const next = missingIn(form);

      // Only a change re-renders: the observer below fires often.
      setMissing((current) =>
        current.join("\n") === next.join("\n") ? current : next,
      );
    };

    // Read the form once the event is over, never during it. Its listeners
    // here run before React's own, at the root; a re-render in between
    // would put a controlled field back to its old value before React's
    // onChange had read the new one. A reset, too, clears values only after
    // its event.
    //
    // A whole task later, not a microtask: a <select> fires `input` and then
    // `change` in one task, and a microtask runs between the two. Reading
    // there re-rendered the form after `input`, React put the select back
    // to its old value, and `change` — which React's onChange reads for a
    // select — saw nothing chosen: no choice ever stuck.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const afterEvent = () => {
      clearTimeout(pending);
      pending = setTimeout(update, 0);
    };

    update();
    form.addEventListener("input", afterEvent);
    form.addEventListener("change", afterEvent);
    form.addEventListener("reset", afterEvent);
    // A field rendered later, or one turned required or disabled.
    const observer = new MutationObserver(update);
    observer.observe(form, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["required", "disabled", "value"],
    });

    return () => {
      clearTimeout(pending);
      form.removeEventListener("input", afterEvent);
      form.removeEventListener("change", afterEvent);
      form.removeEventListener("reset", afterEvent);
      observer.disconnect();
    };
    // `watched` is not read here: its change is the cue to read the form.
  }, [form, watched]);

  return {
    attach,
    ready: missing.length === 0,
    missing,
    hintId,
  };
}

/** Why the main button is held back; nothing once it is not. */
export function SubmitHint({
  id,
  missing,
  className,
}: {
  id: string;
  missing: string[];
  className?: string;
}) {
  if (missing.length === 0) return null;

  return (
    <p
      id={id}
      className={
        className ??
        "flex min-w-0 flex-1 items-center gap-1.5 text-xs text-fg-muted"
      }
    >
      <Info aria-hidden="true" className="size-3.5 shrink-0" />
      Fill in {listOf(missing)} to continue.
    </p>
  );
}
