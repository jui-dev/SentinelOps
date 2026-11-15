"use client";

import { FlaskConical, Menu } from "lucide-react";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { useRouteMembership } from "@/components/organizations/organization-scope";

import { ShellUtilities } from "./shell-utilities";
import { Wordmark } from "./wordmark";

/**
 * The organization-wide operational situation, shown by the strip across the
 * top of the workspace.
 *
 * Only `neutral` exists. Incidents are recorded, but the strip does not yet
 * summarise them — that is the operational overview's job — so it claims no
 * state: it shows where you are, the time, and the shell's utilities. When it does, a provider will
 * supply richer levels here (an active SEV1, a degraded service) and the
 * strip renders them; nothing that consumes the context needs to change
 * shape.
 */
export type SituationLevel = "neutral";

export interface Situation {
  level: SituationLevel;
}

const SituationContext = createContext<Situation>({ level: "neutral" });

export const useSituation = (): Situation => useContext(SituationContext);

/** Colours per level. Each future level adds its band here. */
const LEVEL_STYLES: Record<SituationLevel, string> = {
  neutral: "bg-strip text-strip-fg",
};

/** The strip's frame, shared by the workspace and the sign-in pages. */
export function StripFrame({
  level = "neutral",
  alignToRail = false,
  leading,
  children,
  trailing,
  wordmark = true,
}: {
  level?: SituationLevel;
  /** Sizes the wordmark's cell to sit over the navigation rail. */
  alignToRail?: boolean;
  leading?: ReactNode;
  children?: ReactNode;
  trailing?: ReactNode;
  /** Off where the page names the product itself, as the login page does. */
  wordmark?: boolean;
}) {
  return (
    <header
      data-level={level}
      className={cx(
        // Transparent rule: visible only in forced-colours mode.
        "col-span-full flex h-strip min-w-0 items-stretch border-b border-transparent forced-colors:border-[CanvasText]",
        LEVEL_STYLES[level],
      )}
    >
      <div
        className={cx(
          "flex shrink-0 items-center gap-1.5 px-3 lg:px-4",
          alignToRail && "lg:w-rail",
        )}
      >
        {leading}
        {wordmark && <Wordmark />}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3 px-3 lg:px-4">
        {children}
      </div>
      <div className="flex shrink-0 items-center px-3">{trailing}</div>
    </header>
  );
}

export function SituationStrip({
  onOpenNavigation,
}: {
  onOpenNavigation: () => void;
}) {
  const { level } = useSituation();
  const membership = useRouteMembership();

  return (
    <StripFrame
      level={level}
      alignToRail
      leading={
        <button
          type="button"
          onClick={onOpenNavigation}
          aria-haspopup="dialog"
          className="-ml-1 grid size-7 place-items-center rounded-md text-strip-muted hover:bg-strip-hover hover:text-strip-fg lg:hidden"
        >
          <Menu aria-hidden="true" className="size-4" />
          <span className="sr-only">Open navigation</span>
        </button>
      }
      trailing={<ShellUtilities />}
    >
      {membership && (
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium text-strip-fg">
            {membership.organization.name}
          </span>
          {/* Everything in a demo organization is generated: always said. */}
          {membership.organization.demo && (
            <span
              title="A demo organization: everything in it is generated on this machine"
              className="inline-flex shrink-0 items-center gap-1 self-center rounded-full bg-strip-signal-caution px-2 py-px text-2xs font-bold tracking-[0.05em] text-strip-raised uppercase"
            >
              <FlaskConical aria-hidden="true" strokeWidth={2.25} className="size-3" />
              Demo
            </span>
          )}
          <span aria-hidden="true" className="hidden text-strip-muted md:inline">
            /
          </span>
          <span className="data hidden truncate text-strip-muted md:inline">
            {membership.organization.slug}
          </span>
        </p>
      )}
    </StripFrame>
  );
}
