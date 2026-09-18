"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";

import { cx } from "@/components/ui/cx";
import {
  setThemePreference,
  useThemePreference,
} from "@/lib/theme/theme";
import type { ThemePreference } from "@/lib/theme/theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System theme", Icon: Monitor },
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
];

/**
 * System / light / dark, as a native radio group: arrow keys move the
 * choice, and each option is named for assistive technology. Styled for the
 * ink strip, where it lives.
 */
export function ThemeControl() {
  const name = useId();
  const preference = useThemePreference();

  return (
    <fieldset className="flex items-center gap-px rounded-md border border-ink-line p-px">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map(({ value, label, Icon }) => (
        <label
          key={value}
          title={label}
          className={cx(
            "grid size-6 place-items-center rounded-sm text-ink-muted transition-colors duration-(--duration-fast)",
            "hover:text-ink-fg has-checked:bg-ink-hover has-checked:text-ink-fg",
            "has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ink-accent",
          )}
        >
          <input
            type="radio"
            name={name}
            value={value}
            checked={preference === value}
            onChange={() => setThemePreference(value)}
            className="sr-only"
          />
          <Icon aria-hidden="true" className="size-3.5" />
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
