"use client";

import { Menu } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { useRouteMembership } from "@/components/organizations/organization-scope";

import { ThemeControl } from "./theme-control";
import { Wordmark } from "./wordmark";

/**
 * The organization-wide operational situation, shown by the strip across the
 * top of the workspace.
 *
 * Only `neutral` exists. SentinelOps observes nothing yet — no incidents, no
 * services — so the strip claims no state: it shows where you are and the
 * time. When live operational data arrives, a provider will supply richer
 * levels here (an active incident, a degraded service) and the strip renders
 * them; nothing that consumes the context needs to change shape.
 */
export type SituationLevel = "neutral";

export interface Situation {
  level: SituationLevel;
}

const SituationContext = createContext<Situation>({ level: "neutral" });

export const useSituation = (): Situation => useContext(SituationContext);

/** Colours per level. Each future level adds its band here. */
const LEVEL_STYLES: Record<SituationLevel, string> = {
  neutral: "border-ink-line bg-ink text-ink-fg",
};

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The current time in UTC, to the minute — the reference every SentinelOps
 * timestamp will be read against. Ticks on the minute boundary, and is not a
 * live region: nobody needs it announced.
 */
function UtcClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = new Date();

      setNow(current);
      timer = setTimeout(schedule, 60_000 - (current.getTime() % 60_000) + 50);
    };

    timer = setTimeout(schedule, 60_000 - (Date.now() % 60_000) + 50);

    return () => clearTimeout(timer);
  }, []);

  return (
    <p className="hidden items-baseline gap-1.5 sm:flex">
      <span className="label-caps text-ink-muted">UTC</span>
      <time dateTime={now.toISOString()} className="data text-ink-fg">
        {pad(now.getUTCHours())}:{pad(now.getUTCMinutes())}
      </time>
    </p>
  );
}

/** The strip's frame, shared by the workspace and the sign-in pages. */
export function StripFrame({
  level = "neutral",
  alignToRail = false,
  leading,
  children,
  trailing,
}: {
  level?: SituationLevel;
  /** Sizes and rules the wordmark's cell to sit over the navigation rail. */
  alignToRail?: boolean;
  leading?: ReactNode;
  children?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <header
      data-level={level}
      className={cx(
        "col-span-full flex h-strip min-w-0 items-stretch border-b",
        LEVEL_STYLES[level],
      )}
    >
      <div
        className={cx(
          "flex shrink-0 items-center gap-1.5 px-3 lg:px-4",
          alignToRail && "lg:w-rail lg:border-r lg:border-ink-line",
        )}
      >
        {leading}
        <Wordmark />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3 px-3 lg:px-4">
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-4 px-3">{trailing}</div>
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
          className="-ml-1 grid size-7 place-items-center rounded-md text-ink-muted hover:bg-ink-hover hover:text-ink-fg lg:hidden"
        >
          <Menu aria-hidden="true" className="size-4" />
          <span className="sr-only">Open navigation</span>
        </button>
      }
      trailing={
        <>
          <UtcClock />
          <ThemeControl />
        </>
      }
    >
      {membership && (
        <p className="flex min-w-0 items-baseline gap-2.5">
          <span className="truncate text-sm font-medium text-ink-fg">
            {membership.organization.name}
          </span>
          <span className="data hidden truncate text-ink-muted md:inline">
            {membership.organization.slug}
          </span>
        </p>
      )}
    </StripFrame>
  );
}
