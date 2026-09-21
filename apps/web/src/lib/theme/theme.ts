"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "./theme-script";

/**
 * Dark, light, and system appearances. Dark is SentinelOps' own: it is what
 * anyone who has never chosen sees.
 *
 * The CSS does the real work: every colour token is `light-dark(…)`, and
 * `color-scheme` on <html> picks the half. The stylesheet's default is dark,
 * so with no stored choice nothing needs setting — with or without
 * JavaScript. A choice is a `data-theme` attribute (`system` hands the half
 * to the operating system), written before first paint by THEME_INIT_SCRIPT
 * and kept in step by the hooks below.
 *
 * The choice is per device, in localStorage. It is not an account setting and
 * not a cookie: the server never needs it, and reading a cookie in the root
 * layout would opt every page out of static rendering.
 */

export type ThemePreference = "dark" | "light" | "system";

export const DEFAULT_THEME: ThemePreference = "dark";

const isPreference = (value: unknown): value is ThemePreference =>
  value === "dark" || value === "light" || value === "system";

/** The stored choice. Anything absent, unreadable or unrecognised is dark. */
export const readThemePreference = (): ThemePreference => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);

    return isPreference(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
};

const applyThemeAttribute = (preference: ThemePreference) => {
  document.documentElement.setAttribute("data-theme", preference);
};

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

const subscribePreference = (onChange: () => void) => {
  // Another tab changed the choice: follow it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyThemeAttribute(readThemePreference());
    onChange();
  };

  listeners.add(onChange);
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
};

/**
 * Stores and applies a choice. Storage may be unavailable (blocked site data,
 * some private modes): the choice then lasts until the page is reloaded.
 */
export const setThemePreference = (preference: ThemePreference) => {
  // "system" is stored too: without it, nothing stored means dark.
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not persisted; still applied below.
  }

  applyThemeAttribute(preference);
  notify();
};

/**
 * The current choice. The server snapshot is the default, so a
 * server-rendered control hydrates without a mismatch and then shows the
 * stored value.
 */
export const useThemePreference = (): ThemePreference =>
  useSyncExternalStore(
    subscribePreference,
    readThemePreference,
    () => DEFAULT_THEME,
  );

/**
 * Re-applies the stored choice once mounted. In production the inline script
 * has already done it and this is a no-op; in development, Strict Mode's
 * remount resets <html> to the attributes React manages and drops the one
 * the script set (see the Next.js guide on preventing flash before
 * hydration). Reads storage directly rather than hydrated state, so it never
 * briefly applies the server's default over a stored choice.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyThemeAttribute(readThemePreference());
  }, []);

  return null;
}
