"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useReplaceParams } from "@/components/incidents/incident-filters";
import { incidentsHref } from "@/components/incidents/incident-queries";
import { SEVERITY_LEVELS, SeverityMark } from "@/components/incidents/severity";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { useMinuteClock } from "@/components/ui/timestamp";
import { Permission } from "@/lib/api/contracts";
import type {
  IncidentPeriod,
  IncidentSummaryResponse,
  SeverityCounts,
} from "@/lib/api/contracts";
import { getIncidentSummary } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { periodDays, readPeriodParams, utcDay } from "@/lib/period/period";

import { CustomRangeDialog } from "./custom-range";
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
 * One count in the period's summary: the number, then its label. Its precise
 * meaning is spoken rather than shown — the history beneath shows each
 * incident's declaration and resolution, which is what it means on screen.
 */
function Figure({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  /** What exactly is counted, for screen readers. */
  description: string;
}) {
  return (
    // A phone stacks the number over its label; wider, they share a line.
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="numeric order-first text-lg leading-7 font-semibold text-fg">
        {value}
      </dd>
      <dd className="sr-only">{description}</dd>
    </div>
  );
}

/** The period's severities, in one quiet line: the marks and counts. */
function SeverityMix({ counts }: { counts: SeverityCounts }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
      {/* An h2: on its own page these sit directly under the page's title,
          where they were once inside the Overview panel's heading. */}
      <h2 className="text-sm text-fg-muted">
        Current severity{" "}
        {/* Only where the marks follow on the same line. */}
        <span aria-hidden="true" className="hidden text-fg-subtle sm:inline">
          ·
        </span>
      </h2>
      <dl
        aria-label="Incidents declared in this period, by current severity"
        className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5"
      >
        {SEVERITY_LEVELS.map(({ value }) => (
          <div key={value} className="flex items-baseline gap-1.5 text-sm">
            <dt>
              <SeverityMark severity={value} />
            </dt>
            <dd
              className={cx(
                "numeric font-semibold",
                counts[value] > 0 ? "text-fg" : "text-fg-subtle",
              )}
            >
              {counts[value]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** What the period's figures say, once they have arrived. */
function PeriodFigures({
  period,
}: {
  period: IncidentSummaryResponse["period"];
}) {
  return (
    <div className="flex flex-col gap-5">
      {/*
        A compact summary — three counts, then the severities beneath them —
        ruled off from the history, which is what this page is for.
      */}
      <div className="flex flex-col gap-2 border-b border-line-subtle pb-4">
        <dl
          aria-label="Totals for this period"
          className="grid grid-cols-3 sm:flex sm:flex-wrap sm:items-baseline [&>div+div]:border-l [&>div+div]:border-line-subtle [&>div+div]:pl-3 sm:[&>div+div]:pl-5 sm:[&>div]:pr-5"
        >
          <Figure
            label="Declared"
            value={period.declared}
            description="Incidents declared in this period."
          />
          <Figure
            label="Resolved"
            value={period.resolved}
            description="Incidents resolved in this period, whenever they were declared."
          />
          <Figure
            label="Still open"
            value={period.stillOpen}
            description="Incidents declared in this period and not yet resolved."
          />
        </dl>
        <SeverityMix counts={period.declaredBySeverity} />
      </div>
      <PeriodHistory
        history={period.history}
        period={{ from: period.from, to: period.to }}
      />
    </div>
  );
}

/**
 * Which period the page reports on, kept in the address.
 *
 * The URL is the state: a period can be linked to, returned to, and shared,
 * and a day picked out of the Overview's activity arrives here as
 * `?from=…&to=…`. With neither parameter the page shows its default preset
 * without writing one, so the bare address is the plain way in.
 *
 * Changes `replace` rather than `push`: the period is which days are shown,
 * not a place visited, so Back leaves the page instead of walking through
 * every tab clicked on the way. While a custom range is being chosen the
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
  // arriving by link selects the tab a person would have clicked.
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

/**
 * The summary for one period. Changing the period keeps the last answer on
 * screen until the next arrives, so the history never blanks out.
 */
const useHistory = (organizationId: string, period: IncidentPeriod) =>
  useQuery({
    queryKey: queryKeys.incidentSummary(organizationId, period.from, period.to),
    queryFn: () => getIncidentSummary(organizationId, period),
    placeholderData: keepPreviousData,
    select: (summary: IncidentSummaryResponse) => summary.period,
  });

/** The period's choice, its days, and what happened in them. */
function SelectedPeriod() {
  const organization = useOrganization();
  const selection = usePeriodSelection();
  const history = useHistory(organization.id, selection.period);
  const { choice, period, editing } = selection;

  const shown = history.data;
  const updating = history.isPlaceholderData || (history.isFetching && !shown);

  let figures;

  if (history.isError && !shown) {
    figures = <ErrorAlert error={history.error} />;
  } else if (!shown) {
    figures = <Spinner label="Loading the period…" />;
  } else {
    figures = <PeriodFigures period={shown} />;
  }

  return (
    <Tabs
      label="Period"
      tabs={PERIOD_CHOICES}
      value={choice}
      onChange={selection.choose}
      trailing={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-fg-muted">
            <span className="data text-fg">
              {period.from === period.to
                ? period.from
                : `${period.from} → ${period.to}`}
            </span>{" "}
            · {formatDays(periodDays(period))} · UTC
          </p>
          {/* Kept while the dialog is open: focus returns to it. */}
          {choice === "custom" && (
            <Button variant="quiet" size="sm" onClick={selection.edit}>
              Change dates
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* A modal dialog: shown above the page, never in its flow. */}
        {editing && (
          <CustomRangeDialog
            initial={period}
            today={selection.today}
            onApply={selection.apply}
            onCancel={selection.cancel}
          />
        )}
        <div
          aria-busy={updating}
          className={cx(
            "transition-opacity duration-(--duration-fast)",
            history.isPlaceholderData && "opacity-60",
          )}
        >
          {figures}
        </div>
      </div>
    </Tabs>
  );
}

/**
 * Incident history: every incident declared or resolved in a period of the
 * viewer's choosing, as one chronological record.
 *
 * Historical records and how to find them, and nothing else. Where response
 * stands now, and when the organization has been operationally active, are
 * the Overview's; what one member did is their own page's. This page is the
 * record.
 *
 * The whole of it is one reading of the organization: the period's counts and
 * its history both come from the incident summary, which counts every
 * incident there is — including ones the viewer may not open. So it is
 * offered on `incidents:read-all`, as the Overview is, and not on
 * `incidents:read`, which every role holds. A member's own history is a
 * question this page does not answer and will not: it wants a record scoped
 * to them, which is My Operations' work rather than a narrowing of this.
 */
export function IncidentHistory() {
  const organization = useOrganization();
  const canReadEveryIncident = useCan(Permission.INCIDENTS_READ_ALL);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={incidentsHref(organization.slug)}
            className="rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            ← Incidents
          </Link>
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
