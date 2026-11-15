"use client";

import { Activity } from "lucide-react";
import { IncidentFlow } from "@/components/flow/incident-flow";
import Link from "next/link";

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
import { serviceHref } from "@/components/services/service-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { OnwardLink } from "@/components/ui/onward-link";
import { ListLoading, Spinner } from "@/components/ui/spinner";
import { stretchedLinkClasses } from "@/components/ui/table";
import {
  Duration,
  formatDuration,
  useMinuteClock,
} from "@/components/ui/timestamp";
import { Permission } from "@/lib/api/contracts";
import type {
  ActiveStatusCounts,
  AffectedServiceResponse,
  IncidentResponse,
  IncidentSummaryResponse,
  SeverityCounts,
  TypicalResolutionResponse,
} from "@/lib/api/contracts";

import { INSTRUMENT } from "./analytical-view-header";
import { OperationalActivity } from "./operational-activity";
import { OperationalAttention } from "./operational-attention";
import { OverviewPanel } from "./overview-panel";
import { OverviewSummary } from "./overview-summary";
import { RecentOperationalHealth } from "./recent-operational-health";
import { SetupChecklist } from "./setup-checklist";
import { useCurrentOperations } from "./use-current-operations";
import type { CurrentOperationsState } from "./use-current-operations";

/** How many active incidents the overview lists before "View all". */
const TOP_ACTIVE = 5;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * One reading of the posture: the dimension it counts, named above, then
 * its items, on an ink panel of its own — the same darkest ground the
 * analytical views and the activity calendar are drawn on. The two panels
 * sit side by side from `sm`, one above the other on a phone, each as wide
 * as what it holds.
 */
const GROUP = cx(INSTRUMENT, "flex min-w-0 flex-col gap-2.5 px-4 py-3.5 sm:px-5");
const GROUP_LABEL = "text-xs font-semibold text-fg";
const GROUP_ITEMS = "flex flex-wrap items-center gap-x-6 gap-y-2 text-sm";

/** The two active statuses, in the order an incident moves through them. */
const ACTIVE_STATUSES = ["DECLARED", "INVESTIGATING"] as const;

/**
 * The active incidents counted by lifecycle status: each status in its own
 * pill — the lifecycle vocabulary, drawn as it is everywhere — and how many
 * stand there. From the summary's own aggregate, never counted off the rows
 * beneath, which are only the first few.
 */
function StatusCounts({ counts }: { counts: ActiveStatusCounts }) {
  return (
    <div className={GROUP}>
      {/* The dl's name says the same, for assistive technology. */}
      <p aria-hidden="true" className={GROUP_LABEL}>
        By status
      </p>
      <dl aria-label="Active incidents by status" className={GROUP_ITEMS}>
        {ACTIVE_STATUSES.map((status) => (
          <div key={status} className="flex items-center gap-2">
            <dt>
              <StatusMark status={status} />
            </dt>
            <dd
              className={cx(
                "numeric min-w-[1ch] font-semibold",
                counts[status] > 0 ? "text-fg" : "text-fg-subtle",
              )}
            >
              {counts[status]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The active incidents counted by severity, in one compact line: each
 * level's glyph and code — the severity vocabulary, never a badge — and its
 * count, a level with none quietened rather than left out, so the four read
 * as one scale. How many are active in all is the summary row's figure;
 * this is what that figure is made of.
 */
function SeverityCountsLine({ counts }: { counts: SeverityCounts }) {
  return (
    <div className={GROUP}>
      {/* The dl's name says the same, for assistive technology. */}
      <p aria-hidden="true" className={GROUP_LABEL}>
        By severity
      </p>
      <dl aria-label="Active incidents by severity" className={GROUP_ITEMS}>
        {SEVERITY_LEVELS.map(({ value }) => (
          <div key={value} className="flex items-center gap-2">
            <dt>
              <SeverityMark severity={value} emphasis />
            </dt>
            <dd
              className={cx(
                "numeric min-w-[1ch] font-semibold",
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
 * Where incident response stands: the counts by status and by severity,
 * or — with nothing active — that all is clear.
 */
function Posture({ current }: { current: IncidentSummaryResponse["current"] }) {
  if (current.active === 0) {
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

  // Two readings of the same incidents — where their response stands, and
  // how severe they are — each on its own ink panel: the summary the rows
  // beneath it itemise. Parted by the gap between them, not a rule.
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
      <StatusCounts counts={current.activeByStatus} />
      <SeverityCountsLine counts={current.activeBySeverity} />
    </div>
  );
}

/**
 * The columns one incident is read across, left to right: how severe, which
 * incident, where its response stands, how long it has been open, and what
 * it is affecting. One template, shared by the header and every row, so a
 * value always sits under its heading.
 *
 * Only from `xl`. Narrower, five columns leave the title too little room to
 * be read, so each incident stacks instead — the same parts in the same
 * order, the service on its own line beneath.
 */
const COLUMNS =
  "xl:grid-cols-[5.5rem_minmax(0,1fr)_8.5rem_11rem_12rem]";

/** The rows' inset inside the table's frame. */
const INSET = "px-4 sm:px-5";

/**
 * The header for the columns, drawn where there are columns. Hidden from
 * assistive technology: a list has no column headers to attach it to, so
 * each row carries what the header says in words of its own instead —
 * visible where the header is not, screen-reader-only where it is.
 */
function ColumnHeader() {
  return (
    <div
      aria-hidden="true"
      className={cx(
        "hidden h-9 items-center gap-x-4 border-b border-table-head-line-subtle bg-table-head text-xs font-semibold tracking-[0.01em] whitespace-nowrap text-table-head-fg xl:grid",
        INSET,
        COLUMNS,
      )}
    >
      <span>Severity</span>
      <span>Incident</span>
      <span>Status</span>
      <span>Duration</span>
      <span>Affected service</span>
    </div>
  );
}

/**
 * How long this incident has been open, against how long incidents of its
 * severity have typically taken to resolve — the median over the last
 * ninety days, from the summary.
 *
 * Not a deadline, and not progress: nothing promises an incident will be
 * resolved at the typical time. The bar fills as the incident approaches
 * what is usual for its severity, and stays full past it, where the words
 * say so. With too few resolutions to call anything typical there is no
 * bar at all — never one drawn against a guess.
 *
 * Its fill is neutral: the bar measures time against what is usual, not
 * where the response stands nor how severe the incident is, so it borrows
 * neither colour. "Past typical" is what carries the emphasis. The bar is
 * decoration for assistive technology; the same comparison is spoken.
 */
function DurationBar({
  incident,
  typical,
}: {
  incident: IncidentResponse;
  typical: TypicalResolutionResponse;
}) {
  const now = useMinuteClock();
  const median = typical.bySeverity[incident.severity]?.medianMs ?? null;

  if (median === null || median <= 0) return null;

  const elapsed = Math.max(0, now.getTime() - Date.parse(incident.createdAt));
  const share = elapsed / median;
  const past = share >= 1;
  const usual = `a typical ${formatDuration(median)} for a ${incident.severity}`;

  return (
    // Beside the duration, on the same line, so a row stays two lines tall.
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        title={`Typical for a ${incident.severity}: ${formatDuration(median)}`}
        className="relative hidden h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-line sm:block"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-fg-subtle"
          style={{ width: `${Math.min(share, 1) * 100}%` }}
        />
      </span>
      {past && (
        <span
          aria-hidden="true"
          className="text-2xs leading-4 font-medium whitespace-nowrap text-fg"
        >
          Past typical
        </span>
      )}
      <span className="sr-only">
        {past ? `, past ${usual}` : `, of ${usual}`}
      </span>
    </span>
  );
}

/**
 * One active incident, and the service it is affecting, as one row.
 *
 * The incident's link covers the row, as every incident list's does; the
 * service's own link, where the viewer may read services, sits above it and
 * goes to the service instead. Only the incident's link draws the row's
 * focus ring, so tabbing to the service draws that link's own.
 *
 * Three vocabularies meet in a row and none borrows another's look: the
 * severity glyph, the lifecycle pill, and the duration in the data face.
 * Service criticality is not drawn here: it is a standing classification,
 * not what is happening now, and the summary above already counts the
 * critical services affected. The service's name comes from the incident
 * itself; `affected` — the summary's entry for that service — adds how many
 * active incidents it has, and is left out if the two answers ever disagree
 * about which services are affected.
 */
function OperationRow({
  incident,
  affected,
  typical,
}: {
  incident: IncidentResponse;
  affected: AffectedServiceResponse | undefined;
  typical: TypicalResolutionResponse;
}) {
  const organization = useOrganization();
  const canReadServices = useCan(Permission.SERVICES_READ);
  const critical = incident.severity === "SEV1";
  const { service } = incident;

  return (
    <li
      className={cx(
        "group/row relative grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 py-3 transition-colors duration-(--duration-fast) hover:bg-row-hover hover:shadow-[inset_3px_0_0_var(--color-row-hover-edge)] xl:items-center xl:gap-y-0",
        INSET,
        COLUMNS,
        "has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:-outline-offset-2 has-[[data-row-link]:focus-visible]:outline-focus",
        critical &&
          "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-signal-critical",
      )}
    >
      <div className="row-span-3 text-sm xl:row-span-1">
        <SeverityMark severity={incident.severity} emphasis />
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <Link
          data-row-link
          href={incidentHref(organization.slug, incident.number)}
          className={cx(
            "flex min-w-0 items-baseline gap-2 underline-offset-2",
            stretchedLinkClasses,
          )}
        >
          <span className="data shrink-0 text-fg-subtle">
            {incidentKey(incident.number)}
          </span>{" "}
          <span
            title={incident.title}
            className="truncate text-base font-medium text-fg group-hover/row:text-accent-text group-hover/row:underline"
          >
            {incident.title}
          </span>
        </Link>
        <p className="truncate text-xs text-fg-muted">
          <span className="text-fg-subtle">Team</span> {incident.team.name}
        </p>
      </div>

      {/* One line when stacked; two of the row's columns from `xl`. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm xl:contents">
        <div>
          <StatusMark status={incident.status} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 xl:flex-nowrap">
          <span
            className={cx(
              "numeric whitespace-nowrap",
              critical ? "text-fg" : "text-fg-muted",
            )}
          >
            <span className="xl:sr-only">Open </span>
            <Duration from={incident.createdAt} />
          </span>
          <DurationBar incident={incident} typical={typical} />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <span className="shrink-0 text-xs text-fg-subtle xl:sr-only">
            Affects
          </span>
          {canReadServices ? (
            <Link
              href={serviceHref(organization.slug, service.slug)}
              className="relative z-10 min-w-0 truncate font-medium text-fg underline-offset-2 hover:text-accent-text hover:underline"
            >
              {service.name}
            </Link>
          ) : (
            <span className="min-w-0 truncate font-medium text-fg">
              {service.name}
            </span>
          )}
        </p>
        {affected && (
          <p className="numeric text-xs text-fg-muted">
            {plural(affected.activeIncidents, "active incident")}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * The most urgent few active incidents, in the Incidents page's order — most
 * severe, then longest-running — each with the service it affects. The
 * table has a frame of its own inside the section — the same edge and
 * surface as the other lists on the Overview — beneath the posture above
 * it.
 *
 * Every affected service is still accounted for. The rows show at most
 * `TOP_ACTIVE` incidents, so a service whose incidents are all further down
 * would otherwise vanish from the page; those are named beneath instead.
 */
function ActiveOperations({
  current,
}: {
  current: IncidentSummaryResponse["current"];
}) {
  const organization = useOrganization();
  const canReadServices = useCan(Permission.SERVICES_READ);
  const list = useIncidentList(organization.id, "active");

  if (list.isError) return <ErrorAlert error={list.error} />;
  if (!list.data) return <ListLoading label="Loading active incidents…" />;

  const incidents = list.data.pages[0]?.items.slice(0, TOP_ACTIVE) ?? [];

  if (incidents.length === 0) {
    return (
      <EmptyNote title="No active incidents" glyph={nominalGlyph}>
        Nothing needs a response right now.
      </EmptyNote>
    );
  }

  const affected = new Map(
    current.affectedServices.map((service) => [service.id, service]),
  );
  const shown = new Set(incidents.map(({ service }) => service.id));
  const elsewhere = current.affectedServices.filter(({ id }) => !shown.has(id));
  const truncated = current.active > incidents.length;

  return (
    <div className="flex flex-col gap-3">
      {/* The table's own frame, inside the section. */}
      <div className="overflow-hidden rounded-md border border-line-subtle bg-surface">
        <ColumnHeader />
        <ul
          aria-label="Active incidents"
          className="divide-y divide-line-subtle"
        >
          {incidents.map((incident) => (
            <OperationRow
              key={incident.id}
              incident={incident}
              affected={affected.get(incident.service.id)}
              typical={current.typicalResolution}
            />
          ))}
        </ul>
      </div>

      {(truncated || elsewhere.length > 0) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          {elsewhere.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <h3 id="also-affected-title" className="text-fg-muted">
                Also affected
              </h3>
              <ul
                aria-labelledby="also-affected-title"
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                {elsewhere.map((service) => (
                  <li key={service.id} className="flex items-baseline gap-1.5">
                    {canReadServices ? (
                      <Link
                        href={serviceHref(organization.slug, service.slug)}
                        className="font-medium text-fg underline-offset-2 hover:text-accent-text hover:underline"
                      >
                        {service.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-fg">{service.name}</span>
                    )}
                    <span className="numeric text-xs text-fg-subtle">
                      {plural(service.activeIncidents, "active incident")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Only when the rows are not all of them: then it is the way to
              the rest, not a standing offer. */}
          {truncated && (
            <OnwardLink href={incidentsHref(organization.slug)}>
              View all {current.active} active incidents
            </OnwardLink>
          )}
        </div>
      )}
    </div>
  );
}

/** The state now: the counts by severity, then each incident and what it hits. */
function CurrentOperations({ current: state }: { current: CurrentOperationsState }) {
  let content;

  if (state.isError && !state.data) {
    content = <ErrorAlert error={state.error} />;
  } else if (!state.data) {
    content = <Spinner label="Loading current operations…" />;
  } else {
    const current = state.data;

    // One block, closer than the panel's own rhythm: the counts are the
    // summary the rows beneath them itemise, not a section of their own.
    content = (
      <div className="flex flex-col gap-4">
        <Posture current={current} />
        {current.active > 0 && <ActiveOperations current={current} />}
      </div>
    );
  }

  return (
    <OverviewPanel
      id="current-operations"
      title="Current operations"
      icon={Activity}
      family="operations"
      tone="primary"
      // Which of the two sections this is — not a claim about how fresh
      // the data is.
      label={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-fg-subtle" />
          Now
        </span>
      }
      description="Active incidents, and the services they are affecting."
    >
      {content}
    </OverviewPanel>
  );
}

/**
 * The operational overview, one question per section, read from the top:
 *
 *   the summary row          what is the state right now?
 *   waiting on you, work     what needs my attention?
 *   current operations       what is happening, and what is it affecting?
 *   response flow            how long do incidents wait for someone to
 *                            start, and when were teams stretched?
 *   recent health            are incidents becoming more or less frequent?
 *   operational activity     what has response looked like across the year?
 *
 * The summary row and Current operations are two readings of one request —
 * the figures above, the detail beneath — so they cannot disagree and only
 * ask once. Everything else is its own request, so one failing leaves the
 * rest standing. Which incidents were declared or resolved in a period is a
 * question this page does not answer; it has a page, Incident history,
 * reached from a day chosen on the calendar.
 *
 * The page's own rhythm is set here rather than by PageBody, whose gap is
 * the looser one a page of independent sections wants. These are sections
 * of one dashboard.
 */
export function OperationsOverview() {
  const organization = useOrganization();
  const current = useCurrentOperations(organization.id);

  return (
    <div className="flex flex-col gap-6">
      <SetupChecklist />
      <OverviewSummary state={current} />
      <OperationalAttention />
      <CurrentOperations current={current} />
      <IncidentFlow scope="organization" />
      <RecentOperationalHealth />
      <OperationalActivity />
    </div>
  );
}
