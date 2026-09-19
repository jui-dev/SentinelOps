"use client";

import Link from "next/link";

import {
  incidentHref,
  incidentsHref,
} from "@/components/incidents/incident-queries";
import {
  incidentKey,
  SeverityMark,
  StatusMark,
} from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { quietLinkClasses } from "@/components/ui/link";
import { Duration, formatDuration } from "@/components/ui/timestamp";
import type {
  IncidentHistoryItemResponse,
  IncidentPeriod,
} from "@/lib/api/contracts";

/**
 * What happened in the period, as one chronological history.
 *
 * An incident is here if it was declared in the period, resolved in it, or
 * both — once either way, placed at whichever of the two happened last, so
 * the most recent thing to happen is first. Resolved and running incidents
 * sit together, as they did on the day.
 */

const UTC_TIME = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const UTC_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** The date a day belongs to, without the weekday: "17 Sep". */
const UTC_DAY = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Where an item sits in time: its resolution in the period, or its start. */
const anchorOf = (item: IncidentHistoryItemResponse): string =>
  item.resolvedInPeriod && item.incident.resolvedAt
    ? item.incident.resolvedAt
    : item.incident.createdAt;

const utcDayOf = (iso: string) => iso.slice(0, 10);

/** The items under the UTC date each belongs to, in the order given. */
const byDay = (items: IncidentHistoryItemResponse[]) => {
  const days: { day: string; items: IncidentHistoryItemResponse[] }[] = [];

  for (const item of items) {
    const day = utcDayOf(anchorOf(item));
    const last = days.at(-1);

    if (last?.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }

  return days;
};

/**
 * What happened to this incident in the period, in words: the declaration,
 * the resolution, or both. A moment on another day carries its date, so a
 * row never implies something happened on the day it is filed under.
 */
function Lifecycle({
  item,
  day,
}: {
  item: IncidentHistoryItemResponse;
  day: string;
}) {
  const { incident } = item;
  const sameDay = (iso: string) => utcDayOf(iso) === day;
  const moment = (iso: string) =>
    sameDay(iso)
      ? UTC_TIME.format(new Date(iso))
      : UTC_DAY.format(new Date(iso));
  const declared = `Declared ${moment(incident.createdAt)}`;

  if (item.resolvedInPeriod && incident.resolvedAt) {
    return (
      <>
        {declared} → Resolved {moment(incident.resolvedAt)}
      </>
    );
  }

  return <>{declared}</>;
}

function HistoryRow({
  item,
  day,
}: {
  item: IncidentHistoryItemResponse;
  day: string;
}) {
  const organization = useOrganization();
  const { incident } = item;
  const critical = incident.severity === "SEV1";
  const anchor = anchorOf(item);

  return (
    <li
      className={cx(
        // A phone stacks when and how serious above the title, so the title
        // keeps the full width; wider, they are a column the titles align to.
        "relative flex flex-col gap-1 border-b border-line-subtle py-3 last:border-b-0 hover:bg-hover sm:flex-row sm:gap-4",
        critical &&
          "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-signal-critical",
      )}
    >
      {/* When, then how serious: both quiet. */}
      <div className="flex shrink-0 items-baseline gap-2 pl-3 sm:w-36 sm:pl-4">
        <span className="data text-xs text-fg-subtle">
          {UTC_TIME.format(new Date(anchor))}
        </span>
        <SeverityMark severity={incident.severity} className="text-xs" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 sm:pr-4 sm:pl-0">
        {/* The title is the row: the strongest thing in it. */}
        <div className="flex min-w-0 items-baseline gap-2">
          <Link
            href={incidentHref(organization.slug, incident.number)}
            className="truncate font-medium text-fg underline-offset-2 after:absolute after:inset-0 after:content-[''] hover:text-accent-text hover:underline focus-visible:outline-none"
          >
            {incident.title}
          </Link>
          <span className="data shrink-0 text-xs text-fg-subtle">
            {incidentKey(incident.number)}
          </span>
        </div>
        <p className="truncate text-xs text-fg-muted">
          {incident.service.name} · {incident.team.name}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
          <Lifecycle item={item} day={day} />
          <span aria-hidden="true" className="text-fg-subtle">
            ·
          </span>
          <StatusMark status={incident.status} className="text-xs" />
          <span aria-hidden="true" className="text-fg-subtle">
            ·
          </span>
          <span className="data">
            {incident.resolvedAt ? (
              `lasted ${formatDuration(Date.parse(incident.resolvedAt) - Date.parse(incident.createdAt))}`
            ) : (
              <>
                open <Duration from={incident.createdAt} />
              </>
            )}
          </span>
        </p>
      </div>
    </li>
  );
}

export function PeriodHistory({
  history,
  period,
}: {
  history: { total: number; items: IncidentHistoryItemResponse[] };
  period: IncidentPeriod;
}) {
  const organization = useOrganization();
  const days = byDay(history.items);

  return (
    <section
      aria-labelledby="incidents-in-period"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2">
          <h3
            id="incidents-in-period"
            className="text-[0.9375rem] leading-6 font-semibold text-fg"
          >
            Incidents in this period
          </h3>
          <span className="numeric text-sm text-fg-subtle">
            {history.total}
          </span>
        </div>
        {history.total > 0 && (
          <Link
            href={`${incidentsHref(organization.slug)}?from=${period.from}&to=${period.to}`}
            className={`text-sm text-fg-muted ${quietLinkClasses}`}
          >
            View period incidents →
          </Link>
        )}
      </div>

      {days.length === 0 ? (
        <EmptyNote title="Nothing happened in this period">
          No incident was declared or resolved between these dates.
        </EmptyNote>
      ) : (
        <div className="flex flex-col gap-5">
          {days.map(({ day, items }) => (
            <div key={day} className="flex flex-col gap-2">
              {/* The date is the history's spine: each group under its own. */}
              <div className="flex items-baseline gap-3">
                <h4 className="text-sm font-semibold text-fg">
                  {UTC_DATE.format(new Date(`${day}T00:00:00.000Z`))}
                </h4>
                <span className="h-px flex-1 bg-line-subtle" />
                <span className="numeric text-xs text-fg-subtle">
                  {items.length}
                </span>
              </div>
              <ul className="rounded-md border border-line-subtle bg-surface">
                {items.map((item) => (
                  <HistoryRow key={item.incident.id} item={item} day={day} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
