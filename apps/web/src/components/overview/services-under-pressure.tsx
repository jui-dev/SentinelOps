"use client";

import { Layers } from "lucide-react";
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

import { INSTRUMENT, VIEW, ViewHeader } from "./analytical-view-header";
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
 * Its own colour, deliberately: denim share bars on an ink panel, so the
 * view reads apart from the trend's icy aqua beside it and from the
 * activity calendar below. No severity, lifecycle, feedback, accent, or activity
 * colour, and no criticality — this answers concentration only. An
 * archived service is ranked where the API put it and says so quietly; its
 * incidents are history. What the ranking leaves out is one line beneath
 * it, a remainder, never drawn as though it were a service.
 *
 * Each service reads in one path: its name, the strongest thing in the
 * row; then its figures, small and aligned; then, beneath, a thin bar the
 * row's full width, long enough that shares can be compared by eye before
 * a figure is read.
 *
 * Drawn only when there is something to rank. With nothing declared, the
 * trend's own note already says so.
 */

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

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
        {/* The same figures, aligned for the eye; the sentence above is
            what is read out. */}
        <span
          aria-hidden="true"
          className="numeric shrink-0 text-right text-xs text-fg-muted"
        >
          {plural(service.declared, "incident")}
        </span>
        <span
          aria-hidden="true"
          className="numeric w-9 shrink-0 text-right text-xs font-medium text-fg-muted"
        >
          {formatShare(service.share)}
        </span>
      </div>
      {/* The share, drawn: of every incident in the period, not of the
          busiest service's. */}
      <span
        aria-hidden="true"
        className="relative h-1 overflow-hidden rounded-full bg-pressure-track forced-colors:border forced-colors:border-[CanvasText]"
      >
        <span
          data-share-bar
          className="absolute inset-y-0 left-0 min-w-0.5 rounded-full bg-pressure-bar forced-colors:bg-[CanvasText]"
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
    <div className={VIEW}>
      <ViewHeader
        id="services-under-pressure-title"
        title="Services under pressure"
        definition="Share of the last 30 days' incidents, by service"
        Icon={Layers}
        family="[--family:var(--color-pressure-bar)]"
      />
      <div className={cx(INSTRUMENT, "p-4")}>
        {/* Held to a readable measure when stacked beneath the trend, so a
            name stays near its figures and the bars never span the page. */}
        <ol
          aria-labelledby="services-under-pressure-title"
          className="flex max-w-xl flex-col gap-3.5 xl:max-w-none"
        >
          {top.map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </ol>
      </div>
      {/* Its caption, beneath the panel as the trend's key is. */}
      {others.services > 0 && (
        <p className="numeric text-xs text-fg-muted">
          <span aria-hidden="true">{remainder.short}</span>
          <span className="sr-only">{remainder.text}</span>
        </p>
      )}
    </div>
  );
}
