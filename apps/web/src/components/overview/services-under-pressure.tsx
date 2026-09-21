"use client";

import Link from "next/link";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { serviceHref } from "@/components/services/service-scope";
import { cx } from "@/components/ui/cx";
import { Permission } from "@/lib/api/contracts";
import type {
  IncidentOccurrenceResponse,
  ServiceOccurrenceResponse,
} from "@/lib/api/contracts";

import {
  describeOthers,
  describeServiceShare,
  formatShare,
} from "./occurrence-format";

/**
 * Services under pressure: "where have incidents concentrated?" — the
 * companion to Incident trend's "how often", over the same thirty days.
 *
 * The API's ranking, read as given: the busiest few services, each with how
 * many incidents were declared against it and what share of the period's
 * incidents that is. Nothing is re-sorted, re-counted, or re-shared here;
 * services tied on a count stay in the API's order, and no rank number is
 * drawn, since between a tie it would claim an order that is only a name's.
 *
 * Each bar is the service's share of all the period's incidents — not of
 * the busiest service's — so the bar and its percentage always agree, and
 * incidents spread thinly across many services look spread, not
 * concentrated.
 *
 * Neutral, deliberately. The bars are an analytical reading, not a state:
 * no severity, lifecycle, feedback, accent, or activity colour, and no
 * criticality — this answers concentration only. An archived service is
 * ranked where the API put it and says so quietly; its incidents are
 * history. What the ranking leaves out is one line beneath it, a
 * remainder, never drawn as though it were a service.
 *
 * Drawn only when there is something to rank. With nothing declared, the
 * trend's own note already says so.
 */

/** The fill: a steel neutral, quieter than the trend's azure beside it. */
const BAR_FILL = "bg-fg-subtle";

function ServiceRow({ service }: { service: ServiceOccurrenceResponse }) {
  const organization = useOrganization();
  const canReadServices = useCan(Permission.SERVICES_READ);

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-baseline gap-3 text-sm">
        <p className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {canReadServices ? (
            <Link
              href={serviceHref(organization.slug, service.slug)}
              title={service.name}
              className="min-w-0 truncate font-medium text-fg underline-offset-2 hover:text-accent-text hover:underline"
            >
              {service.name}
            </Link>
          ) : (
            <span
              title={service.name}
              className="min-w-0 truncate font-medium text-fg"
            >
              {service.name}
            </span>
          )}
          {service.archivedAt && (
            <span className="shrink-0 text-xs text-fg-muted">(archived)</span>
          )}
          <span className="sr-only">: {describeServiceShare(service)}</span>
        </p>
        {/* The same figures, aligned in columns for the eye. */}
        <span
          aria-hidden="true"
          className="numeric w-8 shrink-0 text-right font-semibold text-fg"
        >
          {service.declared}
        </span>
        <span
          aria-hidden="true"
          className="numeric w-9 shrink-0 text-right text-xs text-fg-muted"
        >
          {formatShare(service.share)}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="relative h-1.5 overflow-hidden rounded-full bg-line-subtle forced-colors:border forced-colors:border-[CanvasText]"
      >
        <span
          data-share-bar
          className={cx(
            "absolute inset-y-0 left-0 min-w-0.5 rounded-full forced-colors:bg-[CanvasText]",
            BAR_FILL,
          )}
          style={{ width: `${service.share * 100}%` }}
        />
      </span>
    </li>
  );
}

export function ServicesUnderPressure({
  services,
}: {
  services: IncidentOccurrenceResponse["services"];
}) {
  const { top, others } = services;
  const remainder = describeOthers(others);

  return (
    // Held to a readable measure when stacked beneath the trend, so a name
    // stays near its figures and the bars never span the page.
    <div className="flex max-w-xl min-w-0 flex-col gap-4">
      {/* Set as the trend's heading is, so the two read as a pair — and,
          beside it, as tall as the trend's header, so both sit on one line. */}
      <h3
        id="services-under-pressure-title"
        className="flex items-center text-base font-semibold text-fg xl:min-h-9"
      >
        Services under pressure
      </h3>
      <ol
        aria-labelledby="services-under-pressure-title"
        className="flex flex-col gap-3"
      >
        {top.map((service) => (
          <ServiceRow key={service.id} service={service} />
        ))}
      </ol>
      {others.services > 0 && (
        <p className="numeric border-t border-line-subtle pt-3 text-xs text-fg-muted">
          <span aria-hidden="true">{remainder.short}</span>
          <span className="sr-only">{remainder.text}</span>
        </p>
      )}
    </div>
  );
}
