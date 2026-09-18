"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { NavDrawer } from "./nav-drawer";
import { Rail } from "./rail";
import { SituationStrip } from "./situation";

/**
 * The signed-in workspace: the full viewport, not a document column.
 *
 *   ┌──────────── situation strip ────────────┐
 *   │ rail │ main (the only thing that scrolls)│
 *   └──────┴───────────────────────────────────┘
 *
 * Below 1024px the rail moves into a drawer opened from the strip.
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const closeNavigation = useCallback(() => setNavigationOpen(false), []);

  return (
    <div className="grid h-dvh grid-rows-[var(--spacing-strip)_minmax(0,1fr)] bg-canvas lg:grid-cols-[var(--spacing-rail)_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-surface focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-fg focus-visible:shadow-overlay"
      >
        Skip to content
      </a>
      <SituationStrip onOpenNavigation={() => setNavigationOpen(true)} />
      <div className="hidden min-h-0 border-r border-line lg:block">
        <Rail />
      </div>
      <main
        id="main"
        tabIndex={-1}
        className="min-h-0 overflow-y-auto focus:outline-none"
      >
        {children}
      </main>
      {navigationOpen && <NavDrawer onClose={closeNavigation} />}
    </div>
  );
}
