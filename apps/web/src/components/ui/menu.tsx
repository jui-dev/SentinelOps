"use client";

import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, ReactNode, Ref } from "react";

import { cx } from "./cx";

/**
 * A menu button: a trigger and the list of actions or choices it opens —
 * the WAI-ARIA menu button pattern, and no more than the shell needs.
 *
 * Opening moves focus into the menu (onto the checked choice, if any).
 * Arrow keys, Home and End move through it; Enter or Space picks. Escape,
 * or picking, closes it and returns focus to the trigger; Tab or a click
 * elsewhere closes it and lets focus go where it was going.
 */

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  id: string;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

const MenuContext = createContext<{ close: () => void } | null>(null);

const itemsOf = (menu: HTMLElement | null) =>
  Array.from(
    menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ??
      [],
  );

export function Menu({
  label,
  trigger,
  className,
  children,
}: {
  /** The menu's accessible name. */
  label: string;
  trigger: (props: MenuTriggerProps) => ReactNode;
  /** For the menu's width; its appearance is fixed. */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const menuId = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Focus the checked choice, or the first item, once the menu is drawn.
  useEffect(() => {
    if (!open) return;

    const items = itemsOf(menuRef.current);

    (items.find((item) => item.getAttribute("aria-checked") === "true") ??
      items[0])?.focus();
  }, [open]);

  // A press anywhere else closes it, without taking focus back.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);

    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemsOf(menuRef.current);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };

    switch (event.key) {
      case "ArrowDown":
        return move(at + 1);
      case "ArrowUp":
        return move(at - 1);
      case "Home":
        return move(0);
      case "End":
        return move(items.length - 1);
      case "Escape":
        event.preventDefault();
        return close();
      case "Tab":
        return setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative flex">
      {trigger({
        ref: triggerRef,
        id: triggerId,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        onClick: () => setOpen((current) => !current),
        onKeyDown: onTriggerKeyDown,
      })}
      {open && (
        <MenuContext.Provider value={{ close }}>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            className={cx(
              "absolute top-full right-0 z-40 mt-1.5 flex min-w-44 flex-col rounded-lg border border-line bg-surface py-1 text-fg shadow-overlay",
              className,
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

const useMenu = () => {
  const menu = useContext(MenuContext);

  if (!menu) throw new Error("Menu items belong inside a Menu.");

  return menu;
};

const itemClasses =
  "flex h-8 w-full items-center gap-2.5 px-3 text-left text-sm transition-colors duration-(--duration-fast) hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:text-fg focus-visible:-outline-offset-2";

/**
 * A visible heading over the items. Hidden from assistive technology, which
 * hears the menu's own label instead.
 */
export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <p aria-hidden="true" className="label-caps px-3 pt-1.5 pb-1 text-fg-subtle">
      {children}
    </p>
  );
}

/**
 * Content that is read, not chosen — who is signed in, say. Not an item:
 * arrow keys pass over it.
 */
export function MenuSection({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="px-3 py-2">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line-subtle" />;
}

/** An action. Picking it closes the menu first. */
export function MenuItem({
  icon: Icon,
  onSelect,
  children,
}: {
  icon?: LucideIcon;
  onSelect: () => void;
  children: ReactNode;
}) {
  const { close } = useMenu();

  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={() => {
        close();
        onSelect();
      }}
      className={cx(itemClasses, "text-fg-muted")}
    >
      {Icon && (
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
      )}
      {children}
    </button>
  );
}

/** One of a set of choices; the checked one carries a mark, not colour alone. */
export function MenuItemRadio({
  icon: Icon,
  checked,
  onSelect,
  children,
}: {
  icon?: LucideIcon;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const { close } = useMenu();

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      onClick={() => {
        onSelect();
        close();
      }}
      className={cx(
        itemClasses,
        checked ? "font-medium text-fg" : "text-fg-muted",
      )}
    >
      {Icon && (
        <Icon
          aria-hidden="true"
          strokeWidth={1.75}
          className={cx("size-4 shrink-0", checked && "text-accent-text")}
        />
      )}
      <span className="flex-1">{children}</span>
      <Check
        aria-hidden="true"
        className={cx("size-3.5 shrink-0 text-accent-text", !checked && "invisible")}
      />
    </button>
  );
}
