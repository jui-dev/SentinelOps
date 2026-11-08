"use client";

import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";

import { Rail } from "./rail";
import { MODAL_BACKDROP } from "@/components/ui/modal";

const DESKTOP = "(min-width: 64rem)";

/**
 * The rail, below 1024px, as a modal drawer. A native <dialog> opened with
 * showModal(): the rest of the page is inert, focus stays inside, Escape
 * closes it, and focus returns to the button that opened it.
 *
 * Mounted only while open, so the navigation is never in the page twice
 * except while the drawer is showing — when the desktop rail is hidden.
 */
export function NavDrawer({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const openedAt = useRef(pathname);

  useEffect(() => {
    const dialog = ref.current;

    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");

    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, []);

  // Following a link closes it.
  useEffect(() => {
    if (pathname !== openedAt.current) onClose();
  }, [pathname, onClose]);

  // So does the window growing to where the rail shows anyway.
  useEffect(() => {
    const query = window.matchMedia?.(DESKTOP);
    const onChange = () => {
      if (query?.matches) onClose();
    };

    query?.addEventListener("change", onChange);

    return () => query?.removeEventListener("change", onChange);
  }, [onClose]);

  // A click on the backdrop lands on the dialog element itself.
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-label="Navigation"
      onClose={onClose}
      onClick={onClick}
      className={`fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(18rem,85vw)] max-w-none bg-chrome p-0 text-fg shadow-overlay ${MODAL_BACKDROP}`}
    >
      <div className="flex h-full flex-col">
        <div className="flex h-strip shrink-0 items-center justify-between pr-2 pl-4">
          <span className="label-caps text-fg-subtle">Navigation</span>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-rail-hover hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Close navigation</span>
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Rail />
        </div>
      </div>
    </dialog>
  );
}
