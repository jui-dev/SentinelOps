"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { SeverityMark } from "@/components/incidents/severity";
import { cx } from "@/components/ui/cx";
import { controlClasses, describedBy, FieldFrame } from "@/components/ui/field";
import { Duration } from "@/components/ui/timestamp";
import type { KnownIssueResponse } from "@/lib/api/contracts";

/** What the declarer chose: one of the service's known issues, or something new. */
export type KnownIssueChoice =
  | { kind: "known"; issue: KnownIssueResponse }
  | { kind: "new" };

const NEW = "new";

const times = (total: number) =>
  total === 0 ? "not yet" : total === 1 ? "once" : `${total} times`;

/**
 * "What is happening?": a dropdown of the service's known issues, most
 * frequent first, with "Something new" always below them.
 *
 * However many known issues a service has, the open list is one fixed
 * height and scrolls inside; "Something new" sits outside the scrolling
 * part, so it is never lost at the end of a long list.
 *
 * A select-only combobox: the button opens the list and focus moves to it;
 * the arrow keys, Home and End move through the options, Enter or Space
 * chooses, Escape closes and returns to the button, and Tab or a press
 * elsewhere closes it. A hidden required input carries whether anything is
 * chosen, so the form's required-fields check counts it like any field.
 */
export function KnownIssuePicker({
  serviceName,
  issues,
  loading,
  value,
  onChange,
  error,
}: {
  /** The chosen service's name; undefined until one is chosen. */
  serviceName: string | undefined;
  issues: readonly KnownIssueResponse[] | undefined;
  loading: boolean;
  value: KnownIssueChoice | null;
  onChange: (choice: KnownIssueChoice) => void;
  error?: string;
}) {
  const id = useId();
  const listId = useId();
  const optionId = (key: string) => `${listId}-${key}`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const ready = serviceName !== undefined && issues !== undefined;
  // Every option's key in order: the known issues, then something new.
  const keys = [...(issues ?? []).map(({ id: key }) => key), NEW];

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (key: string) => {
    const issue = issues?.find(({ id: candidate }) => candidate === key);

    onChange(issue ? { kind: "known", issue } : { kind: "new" });
    close(true);
  };

  const openList = () => {
    const chosen =
      value?.kind === "known" ? keys.indexOf(value.issue.id) : value ? keys.length - 1 : 0;

    setActive(Math.max(0, chosen));
    setOpen(true);
  };

  // Focus the list once it is open, and keep the active option in view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document
      .getElementById(optionId(keys[active] ?? NEW))
      ?.scrollIntoView?.({ block: "nearest" });
    // optionId and keys follow from listId and issues.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  // A press anywhere else closes it.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);

    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = keys.length - 1;
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, active + 1),
      ArrowUp: () => Math.max(0, active - 1),
      Home: () => 0,
      End: () => last,
      PageDown: () => Math.min(last, active + 5),
      PageUp: () => Math.max(0, active - 5),
    };

    if (moves[event.key]) {
      event.preventDefault();
      setActive(moves[event.key]());
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(keys[active]);
    } else if (event.key === "Escape") {
      // The list's, not the dialog's around it: only the list closes.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const optionClasses = (key: string) =>
    cx(
      "flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left text-sm",
      keys[active] === key ? "bg-hover" : "",
      (value?.kind === "known" ? value.issue.id : value ? NEW : undefined) === key &&
        "font-semibold",
    );

  const hint = !serviceName
    ? "Choose the affected service first."
    : value?.kind === "new"
      ? `Not one of ${serviceName}'s known issues.`
      : undefined;

  return (
    <FieldFrame id={id} label="What is happening?" required hint={hint} error={error}>
      <div ref={rootRef} className="relative">
        {/* Whether anything is chosen, for the form's required-fields check. */}
        <input
          type="hidden"
          required
          data-label="What is happening?"
          value={value ? "chosen" : ""}
        />
        <button
          ref={buttonRef}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          disabled={!serviceName || loading}
          onClick={() => (open ? close(false) : openList())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              openList();
            }
          }}
          className={cx(
            controlClasses("lg"),
            "flex h-auto min-h-9 items-center justify-between gap-3 py-1.5 text-left",
          )}
        >
          {!value ? (
            <span className="text-fg-subtle">
              {loading ? "Loading known issues…" : "Choose what is happening"}
            </span>
          ) : value.kind === "known" ? (
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{value.issue.name}</span>
              <span className="text-xs text-fg-muted">
                Known issue · happened {times(value.issue.occurrences.total)}
                {value.issue.occurrences.lastAt && (
                  <>
                    , last <Duration from={value.issue.occurrences.lastAt} /> ago
                  </>
                )}
              </span>
            </span>
          ) : (
            <span className="font-medium">Something new</span>
          )}
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        </button>

        {open && ready && (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={id}
            aria-activedescendant={optionId(keys[active] ?? NEW)}
            onKeyDown={onListKeyDown}
            className="absolute inset-x-0 top-full z-40 mt-1 flex flex-col rounded-lg border border-line bg-surface p-1 text-fg shadow-overlay focus-visible:outline-2 focus-visible:outline-focus"
          >
            <div className="flex justify-between gap-3 px-2.5 pt-1.5 pb-1 text-xs text-fg-subtle">
              <span>{serviceName} · most frequent first</span>
              {issues.length > 0 && (
                <span>
                  {issues.length} known {issues.length === 1 ? "issue" : "issues"}
                </span>
              )}
            </div>
            {/* One fixed height, whatever the count; it scrolls inside. */}
            <div role="presentation" className="h-56 overflow-y-auto">
              {issues.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-fg-muted">
                  {serviceName} has no known issues yet. Choose Something new,
                  and it can be saved as the first.
                </p>
              ) : (
                issues.map((issue) => (
                  <div
                    key={issue.id}
                    id={optionId(issue.id)}
                    role="option"
                    aria-selected={value?.kind === "known" && value.issue.id === issue.id}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => choose(issue.id)}
                    onPointerMove={() => setActive(keys.indexOf(issue.id))}
                    className={optionClasses(issue.id)}
                  >
                    <span className="min-w-0">{issue.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-normal whitespace-nowrap text-fg-muted">
                      <SeverityMark severity={issue.usualSeverity} />·{" "}
                      {times(issue.occurrences.total)}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div role="presentation" className="mx-1.5 my-1 h-px bg-line" />
            <div
              id={optionId(NEW)}
              role="option"
              aria-selected={value?.kind === "new"}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(NEW)}
              onPointerMove={() => setActive(keys.length - 1)}
              className={cx(optionClasses(NEW), "text-accent-text")}
            >
              <span className="flex items-center gap-2 font-medium">
                <Plus aria-hidden="true" className="size-4" />
                Something new
              </span>
              <span className="text-xs font-normal text-fg-muted">Not in this list</span>
            </div>
          </div>
        )}
      </div>
    </FieldFrame>
  );
}
