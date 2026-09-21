"use client";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

import { IncidentTrend } from "./incident-trend";
import { OverviewPanel } from "./overview-panel";
import { useIncidentOccurrence } from "./use-incident-occurrence";

/**
 * Recent operational health: the last thirty days, between the state now
 * above it and the year beneath. How often incidents have been declared,
 * and — with the services they were declared against — where they have
 * concentrated.
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
    content = <IncidentTrend occurrence={occurrence.data} />;
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
