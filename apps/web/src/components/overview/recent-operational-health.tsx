"use client";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { Spinner } from "@/components/ui/spinner";

import { IncidentTrend } from "./incident-trend";
import { OverviewPanel } from "./overview-panel";
import { ServicesUnderPressure } from "./services-under-pressure";
import { useIncidentOccurrence } from "./use-incident-occurrence";

/**
 * Recent operational health: the last thirty days, between the state now
 * above it and the year beneath. How often incidents have been declared,
 * and — with the services they were declared against — where they have
 * concentrated.
 *
 * The two are one answer read two ways — when, and where — so they share a
 * request and a section. Each has a frame of its own, which is what parts
 * them — no rule between. Side by side from `xl`, the trend takes what
 * width there is and the services a narrow column of their own, so their
 * bars stay compact however wide the page; their headers, their ink panels
 * and their captions each share a row, so the panels are level. Below that they
 * stack, when before where.
 * With nothing declared there is nothing to rank, and the trend, which
 * says so, has the width alone.
 *
 * History, not state, so it reads nothing the sections above it read: its
 * own request, which can fail on its own. Its label names the time it
 * covers, as each section's does — Now, Last 30 days, the year — and makes
 * no claim about how fresh the answer is.
 */
export function RecentOperationalHealth() {
  const organization = useOrganization();
  const occurrence = useIncidentOccurrence(organization.id);

  let content;

  if (occurrence.isError) {
    content = <ErrorAlert error={occurrence.error} />;
  } else if (!occurrence.data) {
    // Roughly the trend's own height, so nothing jumps when it arrives.
    content = (
      <div className="grid min-h-64 place-items-center">
        <Spinner label="Loading recent operational health…" />
      </div>
    );
  } else {
    const { declared, services } = occurrence.data;
    const ranked = declared > 0 && services.top.length > 0;

    content = (
      <div
        className={cx(
          "grid grid-cols-1 gap-4",
          ranked && "xl:grid-cols-[minmax(0,1fr)_21rem] xl:grid-rows-[auto_1fr_auto]",
        )}
      >
        <IncidentTrend occurrence={occurrence.data} />
        {ranked && (
          <div
            data-pair="services"
            className="grid min-w-0 xl:row-span-3 xl:grid-rows-subgrid"
          >
            <ServicesUnderPressure services={services} />
          </div>
        )}
      </div>
    );
  }

  return (
    <OverviewPanel
      id="recent-operational-health"
      title="Recent operational health"
      label={
        <span className="inline-flex items-center rounded-full border border-line bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">
          Last 30 days
        </span>
      }
      description="How often incidents were declared, and where they concentrated. Days are UTC."
    >
      {content}
    </OverviewPanel>
  );
}
