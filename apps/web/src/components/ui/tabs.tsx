"use client";

import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { cx } from "./cx";

/**
 * Tabs per the WAI-ARIA Authoring Practices: one tab stop for the list,
 * arrow keys (and Home/End) move between tabs and select them, and the one
 * panel is labelled by the selected tab.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  trailing,
  children,
}: {
  /** Names the tab list for assistive technology. */
  label: string;
  tabs: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /**
   * Beside the tabs, on the right, above the shared rule: context for what
   * the tabs select, such as the range they apply. Not part of the tab list.
   */
  trailing?: ReactNode;
  /** The selected tab's panel. */
  children: ReactNode;
}) {
  const base = useId();
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const tabId = (tab: T) => `${base}-tab-${tab}`;
  const panelId = `${base}-panel`;

  const select = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length].value;

    onChange(next);
    refs.current.get(next)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.value === value);
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: tabs.length - 1,
    };

    if (event.key in moves) {
      event.preventDefault();
      select(moves[event.key]);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* One rule under the tabs and whatever sits beside them. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line-subtle">
        <div
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="flex gap-4"
        >
          {tabs.map((tab) => {
            const selected = tab.value === value;

            return (
              <button
                key={tab.value}
                ref={(element) => {
                  if (element) refs.current.set(tab.value, element);
                  else refs.current.delete(tab.value);
                }}
                id={tabId(tab.value)}
                type="button"
                role="tab"
                aria-selected={selected}
                // Only the selected tab's panel exists.
                aria-controls={selected ? panelId : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(tab.value)}
                className={cx(
                  "-mb-px border-b-2 pt-1 pb-2 text-sm transition-colors duration-(--duration-fast)",
                  selected
                    ? "border-accent font-medium text-fg"
                    : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {trailing && <div className="pb-2">{trailing}</div>}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(value)}>
        {children}
      </div>
    </div>
  );
}
