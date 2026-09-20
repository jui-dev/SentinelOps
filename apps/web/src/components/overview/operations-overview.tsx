"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import {
  incidentHistoryHref,
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
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { OnwardLink } from "@/components/ui/onward-link";
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
import { Duration, useMinuteClock } from "@/components/ui/timestamp";
import { Permission } from "@/lib/api/contracts";
import type {
  AffectedServiceResponse,
  IncidentResponse,
  IncidentSeverity,
  IncidentSummaryResponse,
  SeverityCounts,
} from "@/lib/api/contracts";
import { getIncidentSummary } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { utcDay } from "@/lib/period/period";

import { OperationalActivity } from "./operational-activity";
import { OperationalAttention } from "./operational-attention";
import { OverviewPanel } from "./overview-panel";

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

/** The state now: posture, the most urgent incidents, the services hit. */
function CurrentOperations({
  current: state,
}: {
  current: ReturnType<typeof useCurrentOperations>;
}) {
  const organization = useOrganization();

  let content;

  if (state.isError && !state.data) {
    content = <ErrorAlert error={state.error} />;
  } else if (!state.data) {
    content = <Spinner label="Loading current operations…" />;
  } else {
    const current = state.data;

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
        // Out to the whole list, and back to what came before it.
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <OnwardLink href={incidentsHref(organization.slug)}>
            All incidents
          </OnwardLink>
          <OnwardLink href={incidentHistoryHref(organization.slug)}>
            Incident history
          </OnwardLink>
        </div>
      }
    >
      {content}
    </OverviewPanel>
  );
}


/**
 * The state of incident response now.
 *
 * The summary endpoint answers in two halves — the state now, and one
 * period's history — and the Overview reads only the first. It must still
 * name a period, so it names the current UTC day: the smallest there is, and
 * the one the workspace clock already shows. Incident history asks for its
 * own period on its own page, and `select` keeps that half from reaching
 * here at all.
 */
const useCurrentOperations = (organizationId: string) => {
  const today = utcDay(useMinuteClock());

  return useQuery({
    queryKey: queryKeys.incidentSummary(organizationId, today, today),
    queryFn: () =>
      getIncidentSummary(organizationId, { from: today, to: today }),
    select: (summary: IncidentSummaryResponse) => summary.current,
  });
};

/**
 * The operational overview, read from the top down: what needs the viewer
 * now, where incident response stands now, and how much the organization has
 * been doing over the last half-year.
 *
 * Three questions, narrowest first, each its own panel and its own request —
 * so one of them failing leaves the other two standing. Which incidents were
 * declared or resolved in a period is a fourth question, and it has a page:
 * Incident history, within Incidents, reached from either panel's header.
 */
export function OperationsOverview() {
  const organization = useOrganization();
  const current = useCurrentOperations(organization.id);

  return (
    <>
      <OperationalAttention />
      <CurrentOperations current={current} />
      <OperationalActivity />
    </>
  );
}
