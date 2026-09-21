"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import type { FocusEvent, KeyboardEvent, ReactNode, Ref } from "react";

import { cx } from "./cx";

/**
 * A button and the panel it opens beside it: a non-modal dialog, for content
 * that is read and followed rather than picked from — links, headings, a
 * list. Where Menu's items are choices, a popover's are the page's own
 * elements, keeping their semantics: a link is a link, and opens in a new
 * tab like any other.
 *
 * Opening leaves where focus goes to the content (see `onOpen`). Escape
 * closes it and returns focus to the trigger. A press elsewhere, or focus
 * leaving it by Tab, closes it and lets focus go where it was going. It
 * does not trap focus: nothing behind it is inert.
 *
 * Controlled: whoever owns it decides when it is open, so it can also close
 * on things only the owner knows about — the page changing, say.
 */

export interface PopoverTriggerProps {
  ref: Ref<HTMLButtonElement>;
  id: string;
  "aria-haspopup": "dialog";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
}

export function Popover({
  open,
  onOpenChange,
  labelledBy,
  trigger,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The id of the panel's own heading, which names it. */
  labelledBy: string;
  trigger: (props: PopoverTriggerProps) => ReactNode;
  /** For the panel's size and placement; its surface is fixed. */
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const triggerId = useId();
  const panelId = useId();

  const closeAndReturnFocus = useCallback(() => {
    onOpenChange(false);
    triggerRef.current?.focus();
  }, [onOpenChange]);

  // A press anywhere else closes it, without taking focus back.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };

    document.addEventListener("pointerdown", onPointerDown);

    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeAndReturnFocus();
    }
  };

  // Focus leaving for somewhere outside — Tab past the end, Shift+Tab past
  // the trigger — closes it. Focus moving within it does not.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;

    if (open && next && !rootRef.current?.contains(next)) onOpenChange(false);
  };

  return (
    <div
      ref={rootRef}
      className="relative flex"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {trigger({
        ref: triggerRef,
        id: triggerId,
        "aria-haspopup": "dialog",
        "aria-expanded": open,
        "aria-controls": open ? panelId : undefined,
        onClick: () => onOpenChange(!open),
      })}
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={labelledBy}
          className={cx(
            "z-40 flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-fg shadow-overlay",
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
