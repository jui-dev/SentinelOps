"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "./theme-script";

/**
 * Light and dark themes.
 *
 * The CSS does the real work: every colour token is `light-dark(…)`, and
 * `color-scheme` on <html> picks the half. With no stored choice nothing is
 * set, so the operating system decides — with or without JavaScript. An
 * explicit choice is a `data-theme` attribute, written before first paint by
 * THEME_INIT_SCRIPT and kept in step by the hooks below.
 *
 * The choice is per device, in localStorage. It is not an account setting and
 * not a cookie: the server never needs it, and reading a cookie in the root
 * layout would opt every page out of static rendering.
 */

export type ThemePreference = "system" | "light" | "dark";

const isExplicit = (value: unknown): value is "light" | "dark" =>
  value === "light" || value === "dark";

/** The stored choice. Anything unreadable or unrecognised means "system". */
export const readThemePreference = (): ThemePreference => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);

    return isExplicit(stored) ? stored : "system";
  } catch {
    return "system";
  }
};

const applyThemeAttribute = (preference: ThemePreference) => {
  const root = document.documentElement;

  if (isExplicit(preference)) root.setAttribute("data-theme", preference);
  else root.removeAttribute("data-theme");
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
  try {
    if (preference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Not persisted; still applied below.
  }

  applyThemeAttribute(preference);
  notify();
};

/**
 * The current choice. The server snapshot is "system", so a server-rendered
 * control hydrates without a mismatch and then shows the stored value.
 */
export const useThemePreference = (): ThemePreference =>
  useSyncExternalStore(
    subscribePreference,
    readThemePreference,
    () => "system",
  );

/**
 * Re-applies the stored choice once mounted. In production the inline script
 * has already done it and this is a no-op; in development, Strict Mode's
 * remount resets <html> to the attributes React manages and drops the one
 * the script set (see the Next.js guide on preventing flash before
 * hydration). Reads storage directly rather than hydrated state, so it never
 * briefly applies the server's "system".
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyThemeAttribute(readThemePreference());
  }, []);

  return null;
}
