"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CircleCheck,
  CircleDashed,
  Siren,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  FilterChip,
  useReplaceParams,
} from "@/components/incidents/incident-filters";
import { incidentsHref } from "@/components/incidents/incident-queries";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { CardRow, Glance, GlanceTile } from "@/components/ui/detail-layout";
import { EmptyNote } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { formatDuration, useMinuteClock } from "@/components/ui/timestamp";
import { Permission } from "@/lib/api/contracts";
import type {
  IncidentPeriod,
  IncidentSummaryResponse,
} from "@/lib/api/contracts";
import {
  getIncidentActivity,
  getIncidentOccurrence,
  getIncidentSummary,
} from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import {
  formatPeriodRange,
  periodDays,
  readPeriodParams,
  utcDay,
} from "@/lib/period/period";

import { CustomRangeDialog } from "./custom-range";
import { FlowChart, SeverityCard } from "./history-chart";
import { HistoryFilterBar, useHistoryFilters } from "./history-filters";
import { PeriodHistory } from "./period-history";
import {
  DEFAULT_PRESET,
  formatDays,
  PERIOD_CHOICES,
  presetFor,
  presetPeriod,
} from "./period";
import type { PeriodChoice } from "./period";

/**
 * Which period the page reports on, kept in the address.
 *
 * The URL is the state: a period can be linked to, returned to, and shared,
 * and a day picked out of the Overview's activity — or out of this page's
 * own chart — arrives as `?from=…&to=…`. With neither parameter the page
 * shows its default preset without writing one, so the bare address is the
 * plain way in.
 *
 * Changes `replace` rather than `push`: the period is which days are shown,
 * not a place visited, so Back leaves the page instead of walking through
 * every choice made on the way. While a custom range is being chosen the
 * period is still the applied one, so the figures stay on screen and say
 * which days they cover. Presets follow the UTC day: past midnight, "Today"
 * is the new day.
 */
const usePeriodSelection = () => {
  const now = useMinuteClock();
  const searchParams = useSearchParams();
  const replace = useReplaceParams();
  const [editing, setEditing] = useState(false);

  const { period: addressed, invalid } = readPeriodParams(
    searchParams.get("from"),
    searchParams.get("to"),
  );

  // A range the API would refuse is taken out of the address rather than
  // quietly ignored, as the Incidents page does with its own.
  useEffect(() => {
    if (invalid) {
      replace((params) => {
        params.delete("from");
        params.delete("to");
      });
    }
    // `replace` is rebuilt every render; whether the address is wrong is
    // what decides whether anything happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalid]);

  const period = addressed ?? presetPeriod(DEFAULT_PRESET, now);
  // A period the address names is shown as its preset when it is one, so
  // arriving by link selects the choice a person would have made.
  const choice: PeriodChoice = addressed
    ? (presetFor(addressed, now) ?? "custom")
    : DEFAULT_PRESET;

  const show = (chosen: IncidentPeriod) =>
    replace((params) => {
      params.set("from", chosen.from);
      params.set("to", chosen.to);
    });

  return {
    today: utcDay(now),
    choice,
    period,
    editing,
    choose: (next: PeriodChoice) => {
      if (next === "custom") {
        setEditing(true);
      } else {
        setEditing(false);
        show(presetPeriod(next, now));
      }
    },
    edit: () => setEditing(true),
    apply: (chosen: IncidentPeriod) => {
      setEditing(false);
      show(chosen);
    },
    cancel: () => setEditing(false),
  };
};

type PeriodSelection = ReturnType<typeof usePeriodSelection>;

/**
 * The period: a choice of preset or custom range, and which days that is,
 * in a band of the rail's own ground.
 */
function PeriodBand({ selection }: { selection: PeriodSelection }) {
  const { choice, period, editing } = selection;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-line-subtle bg-linear-to-b from-rail-top to-rail-mid px-3.5 py-3">
      <div role="group" aria-label="Period" className="flex flex-wrap gap-1.5">
        {PERIOD_CHOICES.map((each) => (
          <FilterChip
            key={each.value}
            pressed={choice === each.value}
            onClick={() => selection.choose(each.value)}
          >
            {each.label}
          </FilterChip>
        ))}
      </div>
      <span aria-hidden="true" className="hidden h-5 w-px bg-line sm:block" />
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
        <CalendarDays
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-4 text-fg-subtle"
        />
        <span className="font-medium text-fg">{formatPeriodRange(period)}</span>
        <span>
          · {formatDays(periodDays(period))} · UTC
        </span>
      </p>
      {/* Kept while the dialog is open: focus returns to it. */}
      {choice === "custom" && (
        <Button variant="quiet" size="sm" onClick={selection.edit}>
          Change dates
        </Button>
      )}
      {/* A modal dialog: shown above the page, never in its flow. */}
      {editing && (
        <CustomRangeDialog
          initial={period}
          today={selection.today}
          onApply={selection.apply}
          onCancel={selection.cancel}
        />
      )}
    </div>
  );
}

/**
 * The summary for one period. Changing the period keeps the last answer on
 * screen until the next arrives, so the page never blanks out.
 */
const usePeriodSummary = (organizationId: string, period: IncidentPeriod) =>
  useQuery({
    queryKey: queryKeys.incidentSummary(organizationId, period.from, period.to),
    queryFn: () => getIncidentSummary(organizationId, period),
    placeholderData: keepPreviousData,
    select: (summary: IncidentSummaryResponse) => summary.period,
  });

/** How much was declared and resolved on each day of the period. */
const usePeriodActivity = (organizationId: string, period: IncidentPeriod) =>
  useQuery({
    queryKey: queryKeys.incidentActivity(organizationId, period.from, period.to),
    queryFn: () => getIncidentActivity(organizationId, period),
    placeholderData: keepPreviousData,
    select: (activity) =>
      activity.days.map((day) => ({
        date: day.date,
        declared: day.counts.declared,
        resolved: day.counts.resolved,
      })),
  });

/**
 * How the period's declarations compare with the same time just before it,
 * in the API's own judgement: none is offered where it says the comparison
 * would not be honest.
 */
const usePreviousComparison = (
  organizationId: string,
  period: IncidentPeriod,
) =>
  useQuery({
    queryKey: queryKeys.incidentOccurrence(
      organizationId,
      period.from,
      period.to,
    ),
    queryFn: () => getIncidentOccurrence(organizationId, period),
    select: (occurrence) =>
      occurrence.previous.comparable
        ? occurrence.declared - occurrence.previous.declared
        : undefined,
  });

/** "▲ 6 on the 7 days before", in words a screen reader says plainly. */
function Comparison({ change, days }: { change: number; days: number }) {
  const before = days === 1 ? "the day before" : `the ${formatDays(days)} before`;

  if (change === 0) return <>Same as {before}</>;

  return (
    <>
      <span aria-hidden="true">{change > 0 ? "▲" : "▼"} </span>
      <span className="sr-only">{change > 0 ? "Up" : "Down"} </span>
      {Math.abs(change)} on {before}
    </>
  );
}

/** The period in four figures. */
function PeriodGlance({
  summary,
  change,
  days,
}: {
  summary?: IncidentSummaryResponse["period"];
  change?: number;
  days: number;
}) {
  const earlier = summary ? summary.history.total - summary.declared : 0;

  return (
    <Glance label="This period" columns={4}>
      <GlanceTile
        label="Declared"
        value={summary?.declared ?? "—"}
        note={
          change === undefined ? undefined : (
            <Comparison change={change} days={days} />
          )
        }
        icon={Siren}
        tone="accent"
      />
      <GlanceTile
        label="Resolved"
        value={summary?.resolved ?? "—"}
        note={earlier > 0 ? `${earlier} declared earlier` : undefined}
        icon={CircleCheck}
        tone="resolved"
      />
      <GlanceTile
        label="Still open"
        value={summary?.stillOpen ?? "—"}
        note="declared in this period"
        icon={CircleDashed}
        tone="warning"
        noteTone={(summary?.stillOpen ?? 0) > 0}
      />
      <GlanceTile
        label="Typical duration"
        value={
          summary?.resolutionMedianMs == null
            ? "—"
            : formatDuration(summary.resolutionMedianMs)
        }
        note={
          summary
            ? summary.resolved > 0
              ? `median of ${summary.resolved} resolved`
              : "none resolved"
            : undefined
        }
        icon={Timer}
        tone="neutral"
      />
    </Glance>
  );
}

/** The period's choice, its figures, its days, and what happened in them. */
function SelectedPeriod() {
  const organization = useOrganization();
  const selection = usePeriodSelection();
  const { period } = selection;
  const days = periodDays(period);
  const { filters, active } = useHistoryFilters();

  const summary = usePeriodSummary(organization.id, period);
  const activity = usePeriodActivity(organization.id, period);
  const comparison = usePreviousComparison(organization.id, period);
  const shown = summary.data;

  const dayCounts = activity.data
    ? new Map(activity.data.map((day) => [day.date, day]))
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PeriodBand selection={selection} />
      {summary.isError && !shown && <ErrorAlert error={summary.error} />}
      <div
        aria-busy={summary.isPlaceholderData}
        className={cx(
          "flex flex-col gap-6 transition-opacity duration-(--duration-fast)",
          summary.isPlaceholderData && "opacity-60",
        )}
      >
        <PeriodGlance
          summary={shown}
          change={comparison.data}
          days={days}
        />
        <CardRow>
          {activity.data ? (
            <FlowChart
              days={activity.data}
              onPick={(date) => selection.apply({ from: date, to: date })}
            />
          ) : activity.isError ? (
            <ErrorAlert error={activity.error} />
          ) : (
            <Spinner label="Loading the period's days…" />
          )}
          {shown ? (
            <SeverityCard counts={shown.declaredBySeverity} />
          ) : (
            <Spinner label="Loading the period…" />
          )}
        </CardRow>
      </div>
      <HistoryFilterBar
        active={active}
        counts={
          shown && {
            total: shown.history.total,
            open: shown.stillOpen,
            resolved: shown.resolved,
          }
        }
      />
      <PeriodHistory
        period={period}
        filters={filters}
        filtered={active}
        dayCounts={dayCounts}
      />
    </div>
  );
}

/**
 * Incident history: every incident declared or resolved in a period of the
 * viewer's choosing, as one chronological record, with what the period
 * amounted to above it.
 *
 * Historical records and how to find them, and nothing else. Where response
 * stands now is the Incidents page's and the Overview's; what one member did
 * is their own page's. This page is the record.
 *
 * The whole of it is one reading of the organization: its counts, its days,
 * and its history each count every incident there is — including ones the
 * viewer may not open. So it is offered on `incidents:read-all`, as the
 * Overview is, and not on `incidents:read`, which every role holds.
 */
export function IncidentHistory() {
  const organization = useOrganization();
  const canReadEveryIncident = useCan(Permission.INCIDENTS_READ_ALL);

  return (
    <>
      <PageHeader
        eyebrow={
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2">
              <li>
                <Link
                  href={incidentsHref(organization.slug)}
                  className="rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Incidents
                </Link>
              </li>
              <li aria-hidden="true" className="text-fg-subtle">
                /
              </li>
              <li aria-current="page" className="text-fg-muted">
                History
              </li>
            </ol>
          </nav>
        }
        title="Incident history"
        description="Every incident declared or resolved in a period you choose, most recent first. Days are UTC."
      />
      <PageBody>
        {canReadEveryIncident ? (
          <SelectedPeriod />
        ) : (
          <EmptyNote title="No history to show">
            This record covers every incident in the organization, which your
            role does not include reading.
          </EmptyNote>
        )}
      </PageBody>
    </>
  );
}
