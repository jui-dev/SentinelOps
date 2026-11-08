"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { cx } from "./cx";
import { MODAL_BACKDROP } from "./modal";

/**
 * A form in a centred dialog over the page it belongs to — creating a
 * service, a team, a member, or declaring an incident.
 *
 * A native <dialog> opened with showModal(), as the manage-incident drawer
 * and the date-range dialog are: the page is inert behind it and focus stays
 * inside. Escape, a click on the backdrop, and Close dismiss it, and focus
 * returns to what opened it. Mount it only while open, so each opening starts
 * from an empty form.
 */
export function FormDialog({
  title,
  description,
  onClose,
  closeOnBackdrop = true,
  size = "md",
  children,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** Off while it shows something that must not be lost to a stray click. */
  closeOnBackdrop?: boolean;
  /** `lg` for a form whose choices sit side by side. */
  size?: "md" | "lg";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;

    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");

    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  // A click on the backdrop lands on the dialog element itself.
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={onClick}
      className={cx(
        "m-auto max-h-[calc(100dvh-2rem)] max-w-none overflow-y-auto rounded-lg border border-line bg-surface p-0 text-fg shadow-overlay",
        MODAL_BACKDROP,
        size === "lg"
          ? "w-[min(38rem,calc(100vw-2rem))]"
          : "w-[min(32rem,calc(100vw-2rem))]",
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-[0.9375rem] font-semibold text-fg">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-0.5 text-sm text-fg-muted">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <X aria-hidden="true" className="size-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className="px-5 py-5">{children}</div>
    </dialog>
  );
}

/** A dialog form's actions: at its foot, the main one last. */
export function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle pt-4">
      {children}
    </div>
  );
}
