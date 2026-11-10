"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Below this, a page is laid out for a phone. */
export const PHONE_MAX = "(min-width: 40rem)";

/**
 * Whether the viewport is at least as wide as `query` says, following it as
 * it changes. True when it cannot say — on the server, or where there is no
 * matchMedia — so the wide layout is the one drawn by default.
 */
export const useMinWidth = (query: string = PHONE_MAX) => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query);

      list?.addEventListener("change", onChange);

      return () => list?.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches !== false,
    () => true,
  );
};
