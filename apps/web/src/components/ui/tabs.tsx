"use client";

import { useId, useRef } from "react";
import type { ComponentType, KeyboardEvent, ReactNode, SVGProps } from "react";

import { cx } from "./cx";

/**
 * Tabs per the WAI-ARIA Authoring Practices: one tab stop for the list,
 * arrow keys (and Home/End) move between tabs and select them, and the one
 * panel is labelled by the selected tab.
 *
 * The selected tab is unmistakable: a thick light-accent underline, a
 * faint accent tint behind it, and its icon in the accent. A tab may carry
 * an icon and a badge — a count, or something that wants attention.
 */
export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** Decorative: the label names the tab. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Beside the label, and part of the tab's name: "9", "1 blocked". */
  badge?: { text: string; tone?: "neutral" | "danger" };
}

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
  tabs: ReadonlyArray<TabItem<T>>;
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
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line">
        <div
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="flex flex-wrap gap-1"
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
                  "group/tab -mb-px inline-flex items-center gap-2 rounded-t-md border-b-[3px] px-3.5 pt-2.5 pb-2 text-[0.9375rem] transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                  selected
                    ? "border-accent-text bg-accent-subtle font-semibold text-fg"
                    : "border-transparent font-medium text-fg-muted hover:bg-hover hover:text-fg",
                )}
              >
                {tab.icon && (
                  <tab.icon
                    aria-hidden="true"
                    className={cx(
                      "size-4 shrink-0",
                      selected ? "text-accent-text" : "text-fg-subtle",
                    )}
                  />
                )}
                {tab.label}
                {/* A space, so the name reads "Changes 9", not "Changes9". */}
                {tab.badge && " "}
                {tab.badge && (
                  <span
                    className={cx(
                      "numeric rounded-full px-1.5 text-xs leading-[1.125rem] font-semibold",
                      tab.badge.tone === "danger"
                        ? "border border-danger-line bg-danger-subtle text-danger-text"
                        : "bg-hover text-fg-muted",
                    )}
                  >
                    {tab.badge.text}
                  </span>
                )}
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
