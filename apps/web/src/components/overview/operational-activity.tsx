"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { ActivityCalendar } from "@/components/activity/activity-calendar";
import { ActivityPanes } from "@/components/activity/activity-panes";
import {
  incidentHistoryHref,
  incidentHref,
} from "@/components/incidents/incident-queries";
import { incidentKey, SeverityMark } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { quietLinkClasses } from "@/components/ui/link";
import { Spinner } from "@/components/ui/spinner";
import { stretchedLinkClasses } from "@/components/ui/table";
import { useMinuteClock } from "@/components/ui/timestamp";
import type {
  ActivityIncidentResponse,
  OperationalActivityCategory,
  OperationalActivityDayResponse,
  OperationalActivityResponse,
} from "@/lib/api/contracts";
import { getIncidentActivity } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { yearOf, yearRange, yearWindow } from "@/lib/activity/calendar";
import { startOfUtcDay } from "@/lib/period/period";

import { OverviewPanel } from "./overview-panel";

/**
 * When this organization has been operationally active, day by day, over the
 * last 26 weeks — and what happened on a day the viewer picks out.
 *
 * The record of the work, not a measure of it. A day is darker because more
 * was recorded on it: incidents declared, responses started and finished,
 * updates written, resolutions. It says when the organization was busy and
 * when it was quiet, and never how well anyone did.
 *
 * It answers "when was this organization active, and what contributed to
 * it". Which incidents were declared or resolved in a period is Incident
 * history's question, and a day here offers the way through to it.
 */

/** What each kind of event is called, in the order a day reads. */
const CATEGORIES: ReadonlyArray<{
  key: OperationalActivityCategory;
  label: string;
}> = [
  { key: "declared", label: "Declared" },
  { key: "responseStarted", label: "Responses started" },
  { key: "update", label: "Updates" },
  { key: "responseCompleted", label: "Responses completed" },
  { key: "resolved", label: "Resolved" },
  { key: "changed", label: "Severity or team changed" },
];

const DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** One incident a day touched: what it is, and how much of the day it was. */
function DayIncident({
  incident,
}: {
  incident: ActivityIncidentResponse;
}) {
  const organization = useOrganization();

  return (
    <li className="relative flex items-baseline gap-2.5 px-3 py-2 hover:bg-hover">
      <span className="shrink-0 text-sm">
        <SeverityMark severity={incident.severity} emphasis />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={incidentHref(organization.slug, incident.number)}
          className={cx(
            "group flex min-w-0 items-baseline gap-2 text-sm underline-offset-2",
            stretchedLinkClasses,
          )}
        >
          <span className="data shrink-0 text-fg-subtle">
            {incidentKey(incident.number)}
          </span>{" "}
          <span
            title={incident.title}
            className="truncate font-medium text-fg group-hover:text-accent-text group-hover:underline"
          >
            {incident.title}
          </span>
        </Link>
        <p className="truncate text-xs text-fg-muted">
          {incident.service.name}
        </p>
      </div>
      {/* How much of the day's activity was this incident's. */}
      <span className="numeric shrink-0 text-xs text-fg-subtle">
        {plural(incident.events, "event")}
      </span>
    </li>
  );
}

/**
 * What happened on the chosen day, in a pane whose height is fixed.
 *
 * The date, what was recorded, and the way on to Incident history stay
 * where they are; only the list of incidents scrolls, so a day with a dozen
 * of them is the same size on screen as a day with one.
 */
function SelectedDay({ day }: { day: OperationalActivityDayResponse }) {
  const organization = useOrganization();
  const counted = CATEGORIES.filter(({ key }) => day.counts[key] > 0);
  const heading = DAY.format(startOfUtcDay(day.date));

  if (day.total === 0) {
    return (
      <div className="flex h-full flex-col gap-1">
        <h3 className="text-sm font-semibold text-fg">
          {heading} <span className="font-normal text-fg-subtle">UTC</span>
        </h3>
        <p className="text-sm text-fg-muted">
          Nothing was recorded on this day.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-fg">
          {heading} <span className="font-normal text-fg-subtle">UTC</span>
        </h3>
        <p className="numeric text-sm text-fg-muted">
          {plural(day.total, "event")}
        </p>
      </div>

      {/*
        Only what happened: a category with none is not a row of zeroes. Two
        even columns rather than a wrapping line, so six kinds of event take
        three rows in a narrow pane and never a different number — what is
        left over is the incident list's, and it is the part that scrolls.
      */}
      <dl
        aria-label="What happened on this day"
        className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 border-b border-line-subtle pb-3"
      >
        {counted.map(({ key, label }) => (
          <div
            key={key}
            className="flex items-baseline justify-between gap-2 text-sm"
          >
            <dt className="min-w-0 truncate text-fg-muted">{label}</dt>
            <dd className="numeric font-semibold text-fg">{day.counts[key]}</dd>
          </div>
        ))}
      </dl>

      {day.incidents.length > 0 && (
        // The one part that gives: a long day scrolls here rather than
        // making the section taller than a quiet day's.
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <h4 className="shrink-0 text-xs font-medium text-fg-muted">
            {day.incidents.length === 1
              ? "The incident involved"
              : "The incidents involved"}
          </h4>
          <ul
            aria-label="Incidents involved on this day"
            // The same quiet scrollbar the calendar's weeks use, so the two
            // surfaces scroll alike.
            className="scrollbar-thin min-h-0 flex-1 divide-y divide-line-subtle overflow-y-auto overscroll-contain rounded-md border border-line-subtle max-lg:max-h-64"
          >
            {day.incidents.map((incident) => (
              <DayIncident key={incident.id} incident={incident} />
            ))}
          </ul>
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
        {day.moreIncidents > 0 && (
          <p className="numeric text-xs text-fg-subtle">
            and {plural(day.moreIncidents, "more incident")}
          </p>
        )}
        {/* Through to the other question: what was declared or resolved. */}
        <Link
          href={incidentHistoryHref(organization.slug, {
            from: day.date,
            to: day.date,
          })}
          className={`text-sm text-fg-muted ${quietLinkClasses}`}
        >
          View this day in Incident history →
        </Link>
      </div>
    </div>
  );
}

/**
 * Before a day is picked: what the whole grid adds up to, in one line, and
 * how to read the rest of it. The only figures on the section, and they are
 * here rather than above the grid so nothing competes with it.
 */
function Resting({
  activity,
  year,
}: {
  activity: OperationalActivityResponse;
  year: number;
}) {
  if (activity.total === 0) {
    return (
      <EmptyNote title={`No operational activity in ${year}`}>
        Incidents declared, responses worked, and updates written appear here
        as they happen.
      </EmptyNote>
    );
  }

  return (
    <p className="text-sm text-fg-muted">
      <span className="numeric font-semibold text-fg">
        {activity.total.toLocaleString()}
      </span>{" "}
      events on{" "}
      <span className="numeric font-semibold text-fg">
        {activity.activeDays}
      </span>{" "}
      {activity.activeDays === 1 ? "day" : "days"} so far this year.{" "}
      <span className="text-fg-subtle">
        Select a day to see what happened on it.
      </span>
    </p>
  );
}

/** The year so far, asked for once and read from the cache after. */
const useOperationalActivity = (organizationId: string, year: number) => {
  const now = useMinuteClock();
  const window = yearWindow(year, now);

  return useQuery({
    queryKey: queryKeys.incidentActivity(
      organizationId,
      window.from,
      window.to,
    ),
    queryFn: () => getIncidentActivity(organizationId, window),
  });
};

export function OperationalActivity() {
  const organization = useOrganization();
  const year = yearOf(useMinuteClock());
  const activity = useOperationalActivity(organization.id, year);
  const [selected, setSelected] = useState<string | null>(null);

  let content;

  if (activity.isError) {
    content = <ErrorAlert error={activity.error} />;
  } else if (!activity.data) {
    // A box the calendar's height, so nothing jumps when it arrives.
    content = (
      <div className="grid min-h-40 place-items-center">
        <Spinner label="Loading operational activity…" />
      </div>
    );
  } else {
    // A day the answer no longer holds is no selection at all.
    const day =
      activity.data.days.find(({ date }) => date === selected) ?? null;

    content = (
      <div className="flex flex-col gap-4">
        <ActivityPanes
          calendar={
            <ActivityCalendar
              days={activity.data.days}
              label={`Operational activity in ${year}`}
              variant="operational"
              // The instrument panel it is placed on (activity-panes.tsx).
              tone="ink"
              selected={day?.date ?? null}
              onSelect={setSelected}
              today={activity.data.to}
              // The whole year is drawn; only the days so far have rows.
              range={yearRange(year)}
            />
          }
          detail={day ? <SelectedDay day={day} /> : undefined}
        />
        {!day && <Resting activity={activity.data} year={year} />}
      </div>
    );
  }

  return (
    <OverviewPanel
      id="operational-activity"
      title="Operational activity"
      label={
        <span className="numeric inline-flex items-center rounded-full border border-line bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">
          {year}
        </span>
      }
      // No onward link here: the section is about days, and the way through
      // to what was declared or resolved belongs to a chosen one, where it
      // carries that day's date with it.
      description="How much incident response this organization did, day by day, across the year. Days are UTC."
    >
      {content}
    </OverviewPanel>
  );
}
