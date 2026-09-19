"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  incidentHref,
  incidentsHref,
  useIncidentList,
} from "@/components/incidents/incident-queries";
import {
  incidentKey,
  SEVERITY_LEVELS,
  SeverityMark,
  StatusMark,
} from "@/components/incidents/severity";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { CriticalityMark } from "@/components/services/criticality-mark";
import { serviceHref } from "@/components/services/service-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { quietLinkClasses } from "@/components/ui/link";
import { Section } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import {
  stretchedLinkClasses,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { Duration, useMinuteClock } from "@/components/ui/timestamp";
import { Permission } from "@/lib/api/contracts";
import type {
  AffectedServiceResponse,
  IncidentPeriod,
  IncidentResponse,
  IncidentSeverity,
  IncidentSummaryResponse,
  SeverityCounts,
} from "@/lib/api/contracts";
import { getIncidentSummary } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { periodDays, utcDay } from "@/lib/period/period";

import { CustomRangeDialog } from "./custom-range";
import { PeriodHistory } from "./period-history";
import { formatDays, PERIOD_CHOICES, presetPeriod } from "./period";
import type { PeriodChoice, PeriodPreset } from "./period";

/** How many active incidents the overview lists before "View all". */
const TOP_ACTIVE = 5;

const SEGMENT_COLOURS: Record<IncidentSeverity, string> = {
  SEV1: "bg-signal-critical",
  SEV2: "bg-signal-high",
  SEV3: "bg-signal-caution",
  SEV4: "bg-signal-advisory",
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** A link with a trailing arrow, for "go to the full list". */
function OnwardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-1.5 text-sm text-fg-muted ${quietLinkClasses}`}
    >
      {children}
      <ArrowRight
        aria-hidden="true"
        className="size-3.5 text-fg-subtle group-hover:text-accent-text"
      />
    </Link>
  );
}

/**
 * Counts per severity: each level's mark, word, and count, over a bar whose
 * segments are proportional to them. The counts are the content; the bar is
 * decoration, and an empty track when there is nothing to count.
 */
function SeverityBreakdown({
  counts,
  label,
}: {
  counts: SeverityCounts;
  label: string;
}) {
  const total = SEVERITY_LEVELS.reduce((sum, { value }) => sum + counts[value], 0);

  return (
    <div className="flex flex-col gap-3">
      <div
        aria-hidden="true"
        className="flex h-1.5 gap-px overflow-hidden rounded-full bg-sunken"
      >
        {total > 0 &&
          SEVERITY_LEVELS.filter(({ value }) => counts[value] > 0).map(
            ({ value }) => (
              <span
                key={value}
                className={cx("h-full", SEGMENT_COLOURS[value])}
                style={{ width: `${(counts[value] / total) * 100}%` }}
              />
            ),
          )}
      </div>
      <dl aria-label={label} className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {SEVERITY_LEVELS.map(({ value }) => (
          <div key={value} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm">
              <SeverityMark severity={value} label />
            </dt>
            <dd
              className={cx(
                "numeric text-[0.9375rem] font-semibold",
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

/** The nominal disc: a real state, "nothing needs a response". */
const nominalGlyph = (
  <svg viewBox="0 0 10 10" className="size-2.5 text-signal-nominal">
    <circle cx="5" cy="5" r="3.75" fill="currentColor" />
  </svg>
);

/**
 * Where incident response stands: how many are active and the most severe of
 * them, then the split by severity. A SEV1 draws the critical edge the
 * incident list gives its SEV1 rows.
 */
function Posture({ current }: { current: IncidentSummaryResponse["current"] }) {
  const worst = SEVERITY_LEVELS.find(
    ({ value }) => current.activeBySeverity[value] > 0,
  );

  if (!worst) {
    return (
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-7 items-center">
          {nominalGlyph}
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-[1.125rem] leading-7 font-semibold text-fg">
            All clear
          </p>
          <p className="text-sm text-fg-muted">
            No active incidents. Nothing needs a response right now.
          </p>
        </div>
      </div>
    );
  }

  const critical = worst.value === "SEV1";

  return (
    <div
      className={cx(
        "relative flex flex-col gap-5",
        critical &&
          "pl-4 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-full before:bg-signal-critical",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="flex items-baseline gap-2.5">
          <span className="numeric text-[2rem] leading-9 font-semibold tracking-[-0.02em] text-fg">
            {current.active}
          </span>
          <span className="text-[1.0625rem] font-medium text-fg">
            {current.active === 1 ? "active incident" : "active incidents"}
          </span>
        </p>
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          Most severe
          <SeverityMark severity={worst.value} label emphasis />
        </p>
      </div>
      <SeverityBreakdown
        counts={current.activeBySeverity}
        label="Active incidents by severity"
      />
    </div>
  );
}

/** The most urgent few active incidents, in the Incidents page's order. */
function TopActiveIncidents({ active }: { active: number }) {
  const organization = useOrganization();
  const list = useIncidentList(organization.id, "active");

  if (list.isError) return <ErrorAlert error={list.error} />;
  if (!list.data) return <Spinner label="Loading active incidents…" />;

  const incidents = list.data.pages[0]?.items.slice(0, TOP_ACTIVE) ?? [];

  if (incidents.length === 0) {
    return (
      <EmptyNote title="No active incidents" glyph={nominalGlyph}>
        Nothing needs a response right now.
      </EmptyNote>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Table label="Active incidents" variant="operational" fixed>
        <colgroup>
          <col className="w-21 sm:w-24" />
          <col />
          <col className="hidden w-32 sm:table-column" />
          <col className="w-19 sm:w-20" />
        </colgroup>
        <THead>
          <TR>
            <TH>Severity</TH>
            <TH>Incident</TH>
            <TH className="hidden sm:table-cell">Status</TH>
            <TH align="end">Duration</TH>
          </TR>
        </THead>
        <TBody>
          {incidents.map((incident) => (
            <ActiveRow key={incident.id} incident={incident} />
          ))}
        </TBody>
      </Table>
      {active > incidents.length && (
        <div>
          <OnwardLink href={incidentsHref(organization.slug)}>
            View all {active} active incidents
          </OnwardLink>
        </div>
      )}
    </div>
  );
}

function ActiveRow({ incident }: { incident: IncidentResponse }) {
  const organization = useOrganization();
  const critical = incident.severity === "SEV1";

  return (
    <TR interactive>
      <TD
        className={cx(
          "relative",
          critical &&
            "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-signal-critical",
        )}
      >
        <SeverityMark severity={incident.severity} emphasis />
      </TD>
      <TD>
        <Link
          href={incidentHref(organization.slug, incident.number)}
          className={cx(
            "group flex min-w-0 items-baseline gap-2 underline-offset-2",
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
        <span className="block truncate text-xs text-fg-muted">
          {incident.service.name} · {incident.team.name}
        </span>
      </TD>
      <TD className="hidden sm:table-cell">
        <StatusMark status={incident.status} />
      </TD>
      <TD
        align="end"
        className={cx(
          "data whitespace-nowrap",
          critical ? "text-fg" : "text-fg-muted",
        )}
      >
        <Duration from={incident.createdAt} />
      </TD>
    </TR>
  );
}

/**
 * Services with active incidents, the worst affected first: the most severe
 * incident, then how critical the service is. Criticality is shown as the
 * classification it is, beside the severity that is the signal.
 */
function AffectedServices({
  services,
}: {
  services: AffectedServiceResponse[];
}) {
  const organization = useOrganization();
  const canReadServices = useCan(Permission.SERVICES_READ);

  if (services.length === 0) {
    return (
      <EmptyNote title="No services affected">
        No service has an active incident.
      </EmptyNote>
    );
  }

  return (
    <ul
      aria-label="Affected services"
      className="flex flex-col rounded-md border border-line-subtle bg-surface"
    >
      {services.map((service) => (
        <li
          key={service.id}
          className="flex flex-col gap-1.5 border-b border-line-subtle px-4 py-3 last:border-b-0"
        >
          <div className="flex items-baseline justify-between gap-3">
            {canReadServices ? (
              <Link
                href={serviceHref(organization.slug, service.slug)}
                className="truncate text-sm font-medium text-fg underline-offset-2 hover:text-accent-text hover:underline"
              >
                {service.name}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium text-fg">
                {service.name}
              </span>
            )}
            <SeverityMark
              severity={service.worstSeverity}
              emphasis
              className="text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-fg-muted">
            <CriticalityMark criticality={service.criticality} />
            <span>
              {service.ownerTeam.name} ·{" "}
              <span className="numeric">
                {plural(service.activeIncidents, "active incident")}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * One of the Overview's two sections, framed the same way: a header band
 * naming it, with a label saying which of the two it is, then its content.
 * The labels — Now, History — are what tell them apart at a glance.
 */
function OverviewPanel({
  id,
  title,
  label,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  /** Which of the two sections this is: a context, not a state. */
  label: ReactNode;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="overflow-hidden rounded-lg border border-line bg-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line bg-thead px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2
              id={`${id}-title`}
              className="text-[0.9375rem] leading-6 font-semibold text-fg"
            >
              {title}
            </h2>
            {label}
          </div>
          {/* What the section covers, directly beneath its name. */}
          <p className="text-sm text-fg-muted">{description}</p>
        </div>
        {actions && <div className="pt-0.5">{actions}</div>}
      </div>
      <div className="flex flex-col gap-7 p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** The state now: posture, the most urgent incidents, the services hit. */
function CurrentOperations({
  summary,
}: {
  summary: ReturnType<typeof useSummary>;
}) {
  const organization = useOrganization();

  let content;

  if (summary.isError && !summary.data) {
    content = <ErrorAlert error={summary.error} />;
  } else if (!summary.data) {
    content = <Spinner label="Loading current operations…" />;
  } else {
    const { current } = summary.data;

    content = (
      <>
        <Posture current={current} />
        {current.active > 0 && (
          <div className="grid items-start gap-x-8 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
            <Section title="Active incidents" level={3}>
              <TopActiveIncidents active={current.active} />
            </Section>
            <Section
              title="Affected services"
              level={3}
              meta={current.affectedServices.length}
            >
              <AffectedServices services={current.affectedServices} />
            </Section>
          </div>
        )}
      </>
    );
  }

  return (
    <OverviewPanel
      id="current-operations"
      title="Current operations"
      // Which of the two sections this is — not a claim about how fresh
      // the data is.
      label={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent-text">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-mark" />
          Now
        </span>
      }
      description="Every unresolved incident, whenever it was declared."
      actions={
        <OnwardLink href={incidentsHref(organization.slug)}>
          All incidents
        </OnwardLink>
      }
    >
      {content}
    </OverviewPanel>
  );
}

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

/**
 * The period's severities, in one quiet line: the marks and counts, with no
 * bar. Current operations owns the proportional bar; repeating it here made
 * the two sections read as the same thing.
 */
function SeverityMix({ counts }: { counts: SeverityCounts }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
      <h3 className="text-sm text-fg-muted">
        Current severity{" "}
        {/* Only where the marks follow on the same line. */}
        <span aria-hidden="true" className="hidden text-fg-subtle sm:inline">
          ·
        </span>
      </h3>
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
        ruled off from the history, which is what this section is for.
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
 * Which period the overview reports on: a preset of days up to today, or an
 * applied custom range. While a custom range is being chosen, the period is
 * still the last one, so its figures stay on screen and say which days they
 * cover. Presets follow the UTC day: past midnight, "Today" is the new day.
 */
const usePeriodSelection = () => {
  const now = useMinuteClock();
  const [choice, setChoice] = useState<PeriodChoice>("7d");
  const [lastPreset, setLastPreset] = useState<PeriodPreset>("7d");
  const [custom, setCustom] = useState<IncidentPeriod | null>(null);
  const [editing, setEditing] = useState(false);

  const period =
    choice === "custom"
      ? (custom ?? presetPeriod(lastPreset, now))
      : presetPeriod(choice, now);

  return {
    today: utcDay(now),
    choice,
    period,
    custom,
    editing,
    choose: (next: PeriodChoice) => {
      setChoice(next);

      if (next === "custom") {
        setEditing(true);
      } else {
        setLastPreset(next);
        setEditing(false);
      }
    },
    edit: () => setEditing(true),
    apply: (chosen: IncidentPeriod) => {
      setCustom(chosen);
      setEditing(false);
    },
    cancel: () => {
      if (!custom) setChoice(lastPreset);
      setEditing(false);
    },
  };
};

/** The period's choice, its days, and what happened in them. */
function SelectedPeriod({
  selection,
  summary,
}: {
  selection: ReturnType<typeof usePeriodSelection>;
  summary: ReturnType<typeof useSummary>;
}) {
  const { choice, period, custom, editing } = selection;

  const shown = summary.data?.period;
  const updating = summary.isPlaceholderData || (summary.isFetching && !shown);

  let figures;

  if (summary.isError && !summary.data) {
    figures = <ErrorAlert error={summary.error} />;
  } else if (!shown) {
    figures = <Spinner label="Loading the period…" />;
  } else {
    figures = <PeriodFigures period={shown} />;
  }

  return (
    <OverviewPanel
      id="incident-history"
      title="Incident history"
      label={
        <span className="inline-flex items-center rounded-full border border-line bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">
          Selected period
        </span>
      }
      description="What happened during the selected period. Days are UTC."
    >
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
            {choice === "custom" && custom && (
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
              summary.isPlaceholderData && "opacity-60",
            )}
          >
            {figures}
          </div>
        </div>
      </Tabs>
    </OverviewPanel>
  );
}

/**
 * The summary for one period. Changing the period keeps the last answer on
 * screen until the next arrives, so the current state never blanks out.
 */
const useSummary = (organizationId: string, period: IncidentPeriod) =>
  useQuery({
    queryKey: queryKeys.incidentSummary(organizationId, period.from, period.to),
    queryFn: () => getIncidentSummary(organizationId, period),
    placeholderData: keepPreviousData,
  });

/**
 * The operational overview: the current state of incident response, then
 * incidents in a period of the viewer's choosing. One summary request serves
 * both; the current half does not depend on the period.
 */
export function OperationsOverview() {
  const organization = useOrganization();
  const selection = usePeriodSelection();
  const summary = useSummary(organization.id, selection.period);

  // Now, then history: two panels framed alike, told apart by their labels.
  return (
    <>
      <CurrentOperations summary={summary} />
      <SelectedPeriod selection={selection} summary={summary} />
    </>
  );
}
