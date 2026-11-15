"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import {
  ChevronsDown,
  Eye,
} from "lucide-react";

import { incidentHref } from "@/components/incidents/incident-queries";
import {
  incidentKey,
  SeverityMark,
  StatusMark,
} from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Duration, formatDuration } from "@/components/ui/timestamp";
import type {
  IncidentHistoryFilters,
  IncidentHistoryItemResponse,
  IncidentPeriod,
} from "@/lib/api/contracts";
import { listIncidentHistory } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { ButtonLink } from "@/components/ui/button-link";

/**
 * What happened in the period, as one chronological history.
 *
 * An incident is here if it was declared in the period, resolved in it, or
 * both — once either way, placed at whichever of the two happened last, so
 * the most recent thing to happen is first. Resolved and running incidents
 * sit together, as they did on the day. Every one of them, a page at a time.
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

/** The date a moment belongs to, without the weekday: "17 Sep". */
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
const byDay = (items: readonly IncidentHistoryItemResponse[]) => {
  const days: { day: string; items: IncidentHistoryItemResponse[] }[] = [];

  for (const item of items) {
    const day = utcDayOf(anchorOf(item));
    const last = days.at(-1);

    if (last?.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }

  return days;
};

/** Every page of a period's history, narrowed by the filters. */
export const useIncidentHistory = (
  organizationId: string,
  period: IncidentPeriod,
  filters: IncidentHistoryFilters,
) =>
  useInfiniteQuery({
    queryKey: queryKeys.incidentHistory(
      organizationId,
      period.from,
      period.to,
      filters,
    ),
    queryFn: ({ pageParam }) =>
      listIncidentHistory(organizationId, period, pageParam ?? undefined, filters),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.cursor,
    // A new period or filter keeps the last answer on screen until the next.
    placeholderData: keepPreviousData,
  });

/**
 * What of this incident happened in the period, in words: the declaration,
 * the resolution, or both. A moment on another day carries its date and is
 * quieter, so a row never implies something happened on the day it is
 * filed under.
 */
function InPeriod({
  item,
  day,
}: {
  item: IncidentHistoryItemResponse;
  day: string;
}) {
  const { incident } = item;
  const moment = (iso: string) => {
    const sameDay = utcDayOf(iso) === day;

    return {
      text: sameDay
        ? UTC_TIME.format(new Date(iso))
        : UTC_DAY.format(new Date(iso)),
      className: sameDay ? "text-fg-muted" : "text-fg-subtle",
    };
  };
  const declared = moment(incident.createdAt);
  const resolved =
    item.resolvedInPeriod && incident.resolvedAt
      ? moment(incident.resolvedAt)
      : undefined;

  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      <span className={declared.className}>Declared {declared.text}</span>
      {resolved && (
        <>
          {" "}
          <span aria-hidden="true" className="text-fg-subtle">
            →
          </span>{" "}
          <span className="text-status-resolved-text">
            Resolved {resolved.text}
          </span>
        </>
      )}
    </span>
  );
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
  const key = incidentKey(incident.number);
  const critical = incident.severity === "SEV1";

  return (
    <TR>
      <TD
        kind="data"
        className={cx(
          "relative",
          critical &&
            "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-signal-critical",
        )}
      >
        {UTC_TIME.format(new Date(anchorOf(item)))}
      </TD>
      <TD>
        <SeverityMark severity={incident.severity} emphasis />
      </TD>
      <TD>
        <span className="flex min-w-0 flex-col py-1.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="data shrink-0 text-fg-subtle">{key}</span>
            <span title={incident.title} className="truncate font-medium text-fg">
              {incident.title}
            </span>
          </span>
          <span className="truncate text-xs text-fg-subtle">
            {incident.service.name} · {incident.team.name}
          </span>
        </span>
      </TD>
      <TD className="hidden text-sm md:table-cell">
        <InPeriod item={item} day={day} />
      </TD>
      <TD className="hidden sm:table-cell">
        <StatusMark status={incident.status} />
      </TD>
      <TD kind="data" align="end">
        {incident.resolvedAt ? (
          formatDuration(
            Date.parse(incident.resolvedAt) - Date.parse(incident.createdAt),
          )
        ) : (
          <span className="text-warning-text">
            open <Duration from={incident.createdAt} />
          </span>
        )}
      </TD>
      <TD align="end">
        <ButtonLink
          href={incidentHref(organization.slug, incident.number)}
          aria-label={`View ${key}`}
          variant="view"
          size="sm"
          icon={Eye}
        >
          View
        </ButtonLink>
      </TD>
    </TR>
  );
}

/** What a day's heading says happened on it, from the day's own counts. */
const dayNote = (counts?: { declared: number; resolved: number }) =>
  counts
    ? [
        counts.declared > 0 && `${counts.declared} declared`,
        counts.resolved > 0 && `${counts.resolved} resolved`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

/**
 * Every incident something happened to in the period, under the UTC day it
 * is placed on — a page at a time, with how many there are in all.
 */
export function PeriodHistory({
  period,
  filters,
  filtered,
  dayCounts,
}: {
  period: IncidentPeriod;
  filters: IncidentHistoryFilters;
  /** Whether any filter applies, which changes what an empty answer means. */
  filtered: boolean;
  /** How much was declared and resolved on each day, once known. */
  dayCounts?: ReadonlyMap<string, { declared: number; resolved: number }>;
}) {
  const organization = useOrganization();
  const history = useIncidentHistory(organization.id, period, filters);
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const total = history.data?.pages[0]?.total;
  const days = byDay(items);
  const columns = 7;

  let body;

  if (history.isError && !history.data) {
    body = <ErrorAlert error={history.error} />;
  } else if (!history.data) {
    body = <Spinner label="Loading the period's incidents…" />;
  } else if (items.length === 0) {
    body = filtered ? (
      <EmptyNote title="No incidents match">
        Nothing in this period matches these filters.
      </EmptyNote>
    ) : (
      <EmptyNote title="Nothing happened in this period">
        No incident was declared or resolved between these dates.
      </EmptyNote>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <Table label="Incidents in this period" variant="operational"
          columns={["time", "severity", "main", { kind: "wide", from: "md" }, { kind: "status", from: "sm" }, "duration", "actions"]}
        >
          <THead>
            <TR>
              <TH>Time</TH>
              <TH>Severity</TH>
              <TH>Incident</TH>
              <TH className="hidden md:table-cell">In this period</TH>
              <TH className="hidden sm:table-cell">Status</TH>
              <TH align="end">Lasted</TH>
              <TH align="end">Actions</TH>
            </TR>
          </THead>
          {days.map(({ day, items: dayItems }) => {
            const note = dayNote(dayCounts?.get(day));

            return (
              <tbody key={day}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={columns}
                    className="h-9 border-b border-line-subtle bg-sunken px-3 text-left text-xs font-semibold tracking-wide text-fg sm:px-4"
                  >
                    {UTC_DATE.format(new Date(`${day}T00:00:00.000Z`))}
                    {note && (
                      <span className="ml-2 font-normal tracking-normal text-fg-subtle">
                        {note}
                      </span>
                    )}
                  </th>
                </tr>
                {dayItems.map((item) => (
                  <HistoryRow key={item.incident.id} item={item} day={day} />
                ))}
              </tbody>
            );
          })}
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">
            Showing <span className="numeric text-fg">{items.length}</span> of{" "}
            <span className="numeric text-fg">{total}</span>
          </p>
          {history.hasNextPage && (
            <Button icon={ChevronsDown}
              variant="secondary"
              size="sm"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="incidents-in-period"
      aria-busy={history.isPlaceholderData}
      className={cx(
        "flex flex-col gap-3 transition-opacity duration-(--duration-fast)",
        history.isPlaceholderData && "opacity-60",
      )}
    >
      <h2
        id="incidents-in-period"
        className="text-base font-semibold text-fg"
      >
        Incidents in this period
        {total !== undefined && (
          <span className="numeric ml-1.5 font-normal text-fg-subtle">
            {total}
          </span>
        )}
      </h2>
      {body}
    </section>
  );
}
