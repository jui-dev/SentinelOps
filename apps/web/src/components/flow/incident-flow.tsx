"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  incidentHref,
  LIVE_POLL_MS,
} from "@/components/incidents/incident-queries";
import { incidentKey, SeverityMark } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { EmptyNote } from "@/components/ui/empty-state";
import { FilterGroup, FilterOption } from "@/components/ui/filter-bar";
import { cx } from "@/components/ui/cx";
import { Spinner } from "@/components/ui/spinner";
import { INSTRUMENT } from "@/components/overview/analytical-view-header";
import { formatDuration } from "@/components/ui/timestamp";
import type {
  IncidentFlowFiguresResponse,
  IncidentFlowItemResponse,
  IncidentFlowResponse,
} from "@/lib/api/contracts";
import { getIncidentFlow } from "@/lib/api/endpoints";
import { isWeekend } from "@/lib/period/week";
import { queryKeys } from "@/lib/api/query-keys";

/**
 * Response flow: how teams' incidents ran over the last week or two, one
 * row each — an amber stretch while it waited for someone to start, a blue
 * one while it was worked, and its end once resolved — against the days,
 * with a line at now.
 *
 * What the lists and tiles around it cannot say: how long incidents sit
 * before anyone picks them up, and when a team had several on at once.
 * Team-level throughout — the figures are the API's, about incidents and
 * teams, never about a person. A member sees where their own updates fell
 * as dots on the rows; nobody else's are ever sent.
 *
 * Framed as every other Overview section — the thead band over the plain
 * surface (see `flow-teams` and `flow-organization` in globals.css) — in a
 * frame of fixed size: past what fits, it scrolls inside
 * itself, with the day axis pinned above and the incident names pinned
 * beside. Fourteen days are given more width than the frame has, so they
 * scroll sideways rather than squeeze.
 *
 * Every row is one link to its incident, named with what the bar shows, so
 * nothing on it is said by colour or position alone. Pointing at or
 * focusing a row says its times in the strip beneath.
 *
 * On a phone the frame becomes a list instead: one incident under another,
 * each with its words, a slim track of the whole window beneath them, and
 * its times written out, since there is nothing to point with. The page
 * scrolls; the list never does sideways.
 */

/** Wide enough for the timeline's grid; narrower, the list is drawn. */
const WIDE = "(min-width: 40rem)";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia?.(WIDE);

  query?.addEventListener("change", onChange);

  return () => query?.removeEventListener("change", onChange);
};

/** The timeline, unless the viewport says it is a phone's (or cannot say). */
const useWide = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(WIDE).matches !== false,
    () => true,
  );

const RANGES = [7, 14] as const;
type Range = (typeof RANGES)[number];

const DAY_MS = 86_400_000;

const WEEKDAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  timeZone: "UTC",
});

const MONTH = new Intl.DateTimeFormat(undefined, {
  month: "short",
  timeZone: "UTC",
});

const MOMENT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** The flow for the last `days`, kept live, keeping the last answer on screen. */
export const useIncidentFlow = (organizationId: string, days: Range) =>
  useQuery({
    queryKey: queryKeys.incidentFlow(organizationId, days),
    queryFn: () => getIncidentFlow(organizationId, days),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_POLL_MS,
  });

/** Where an instant sits across the window, as a share of its width, clipped. */
const shareOf = (at: number, start: number, end: number) =>
  Math.min(1, Math.max(0, (at - start) / (end - start)));

const percent = (share: number) => `${(share * 100).toFixed(3)}%`;

type Phase = "waiting" | "working" | "resolved";

const phaseOf = (incident: IncidentFlowItemResponse): Phase =>
  incident.resolvedAt
    ? "resolved"
    : incident.startedAt
      ? "working"
      : "waiting";

/** How long it was worked: from the first start to its resolution or now. */
const workMs = (incident: IncidentFlowItemResponse, asOf: number) =>
  incident.startedAt
    ? (incident.resolvedAt ? Date.parse(incident.resolvedAt) : asOf) -
      Date.parse(incident.startedAt)
    : 0;

/** What the bar shows, in words: the label beside it, and the row's name. */
const describe = (incident: IncidentFlowItemResponse, asOf: number) => {
  const wait = formatDuration(incident.waitMs);

  switch (phaseOf(incident)) {
    case "waiting":
      return `waiting ${wait}`;
    case "working":
      return incident.startedAt
        ? `waited ${wait} · working ${formatDuration(workMs(incident, asOf))}`
        : `waiting ${wait}`;
    case "resolved":
      return incident.startedAt
        ? `waited ${wait} · worked ${formatDuration(workMs(incident, asOf))}`
        : `resolved after ${wait}, never started`;
  }
};

/** Each day of the window, for the axis and its columns. */
const daysOf = (from: string, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.parse(`${from}T00:00:00.000Z`) + index * DAY_MS);

    return {
      key: date.toISOString().slice(0, 10),
      weekday: WEEKDAY.format(date),
      date: date.getUTCDate(),
      month: index === 0 || date.getUTCDate() === 1 ? MONTH.format(date) : "",
      weekend: isWeekend(date.toISOString().slice(0, 10)),
    };
  });

/** The colours of a bar's two stretches, from the flow's own tokens. */
const WAIT = "var(--color-flow-wait)";
const WORKED = "var(--color-flow-declared)";

/** One figure as a chip: the number first, then what it counts and why. */
function Figure({
  label,
  value,
  note,
  warning = false,
}: {
  label: string;
  value: string;
  note: string;
  warning?: boolean;
}) {
  return (
    <div
      className={cx(
        "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-lg border py-1.5 pr-3.5 pl-3",
        warning
          ? "border-warning-line bg-warning-subtle"
          : "border-(--flow-line) bg-(--flow-strip)",
      )}
    >
      <dt className="self-end text-xs leading-4 font-medium text-fg">{label}</dt>
      <dd
        className={cx(
          "numeric order-first row-span-2 text-2xl leading-8 font-semibold tracking-[-0.02em]",
          warning ? "text-warning-text" : "text-fg",
        )}
      >
        {value}
      </dd>
      <dd
        className={cx(
          "self-start text-2xs leading-4",
          warning ? "text-warning-text" : "text-fg-muted",
        )}
      >
        {note}
      </dd>
    </div>
  );
}

function Figures({ figures }: { figures: IncidentFlowFiguresResponse }) {
  const most = figures.mostAtOnce;

  return (
    <dl
      aria-label="Response flow figures"
      className="flex flex-wrap gap-2.5 px-4 py-3.5 sm:px-5"
    >
      <Figure
        label="Typical wait"
        value={
          figures.typicalWaitMs === null ? "—" : formatDuration(figures.typicalWaitMs)
        }
        note={
          figures.started > 0
            ? `median of ${figures.started} started`
            : "nothing started yet"
        }
      />
      <Figure
        label="Most at once"
        value={most ? String(most.count) : "—"}
        note={most ? `from ${MOMENT.format(new Date(most.at))}` : "nothing ran"}
      />
      <Figure
        label="Waiting now"
        value={String(figures.waitingNow)}
        note={figures.waitingNow > 0 ? "nobody has started" : "none waiting"}
        warning={figures.waitingNow > 0}
      />
    </dl>
  );
}

/**
 * The bar for one incident: amber while it waited, blue while it was
 * worked — fading towards now while it still is — and a teal dot where it
 * was resolved. No words beside it: they are in the row's name, and in the
 * tooltip beside the bar when it is pointed at.
 */
function Bar({
  incident,
  start,
  end,
  asOf,
  showUpdates,
}: {
  incident: IncidentFlowItemResponse;
  start: number;
  end: number;
  asOf: number;
  showUpdates: boolean;
}) {
  const declared = Date.parse(incident.createdAt);
  const started = incident.startedAt ? Date.parse(incident.startedAt) : null;
  const resolved = incident.resolvedAt ? Date.parse(incident.resolvedAt) : null;

  const from = shareOf(declared, start, end);
  const waitEnd = shareOf(started ?? resolved ?? asOf, start, end);
  const workEnd = shareOf(resolved ?? asOf, start, end);
  const finish = started !== null ? workEnd : waitEnd;

  return (
    <>
      <span
        aria-hidden="true"
        className={cx(
          "absolute top-1/2 h-2 min-w-1.5 -translate-y-1/2 rounded-l-full",
          started === null && "rounded-r-full",
        )}
        style={{
          backgroundColor: WAIT,
          left: percent(from),
          width: percent(Math.max(0, waitEnd - from)),
        }}
      />
      {started !== null && (
        <span
          aria-hidden="true"
          className={cx(
            "absolute top-1/2 h-2 min-w-1.5 -translate-y-1/2",
            resolved !== null && "rounded-r-full",
          )}
          style={{
            left: percent(waitEnd),
            width: percent(Math.max(0, workEnd - waitEnd)),
            background:
              resolved !== null
                ? WORKED
                : `linear-gradient(90deg, ${WORKED} 70%, color-mix(in srgb, ${WORKED} 35%, transparent))`,
          }}
        />
      )}
      {resolved !== null && (
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_3px_var(--flow-bottom)]"
          style={{ left: percent(finish), backgroundColor: "var(--flow-resolved)" }}
        />
      )}
      {showUpdates &&
        incident.yourUpdates.map((at) => (
          <span
            key={at}
            aria-hidden="true"
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg shadow-[0_0_0_2px_var(--flow-bottom)]"
            style={{ left: percent(shareOf(Date.parse(at), start, end)) }}
          />
        ))}
    </>
  );
}

/** Where a bar ends across the window: the tooltip's anchor. */
const finishOf = (
  incident: IncidentFlowItemResponse,
  start: number,
  end: number,
  asOf: number,
) =>
  shareOf(incident.resolvedAt ? Date.parse(incident.resolvedAt) : asOf, start, end);

/** A team's name as a tag, beside the incidents it is responsible for. */
function TeamTag({ name }: { name: string }) {
  return (
    <span className="inline-block max-w-full truncate rounded-full border border-(--flow-line) px-2 text-xs leading-5 text-fg-muted">
      {name}
    </span>
  );
}

/** A team's heading: folds its incidents away, and says what it has on. */
function TeamToggle({
  group,
  open,
  onToggle,
}: {
  group: IncidentFlowResponse["teams"][number];
  open: boolean;
  onToggle: () => void;
}) {
  const active = group.incidents.filter(({ resolvedAt }) => !resolvedAt);
  const waiting = group.incidents.filter(
    (incident) => phaseOf(incident) === "waiting",
  ).length;

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex items-baseline gap-2 rounded-sm px-2 text-left focus-visible:outline-2 focus-visible:outline-focus"
    >
      <ChevronRight
        aria-hidden="true"
        strokeWidth={2}
        className={cx(
          "size-3.5 self-center text-fg-subtle transition-transform duration-(--duration-fast)",
          open && "rotate-90",
        )}
      />
      <span className="text-xs font-semibold tracking-wider text-fg uppercase">
        {group.name}
      </span>
      <span
        className={cx(
          "text-xs",
          active.length === 0
            ? "text-status-resolved-text"
            : waiting > 0
              ? "text-warning-text"
              : "text-fg-muted",
        )}
      >
        {active.length === 0
          ? group.incidents.length === 0
            ? "all clear"
            : `all clear · ${group.incidents.length} resolved`
          : `${active.length} active${waiting > 0 ? ` · ${waiting} waiting` : ""}`}
      </span>
    </button>
  );
}

/** A team's own figures, where every team is shown. */
const teamFigures = (figures: IncidentFlowFiguresResponse) =>
  figures.typicalWaitMs === null
    ? null
    : `typical wait ${formatDuration(figures.typicalWaitMs)}${
        figures.mostAtOnce ? ` · most at once ${figures.mostAtOnce.count}` : ""
      }`;

/**
 * The phone's reading: the same teams and incidents as the timeline, one
 * under another. Each incident's track spans the whole window, under one
 * axis of dates at the top, so where it fell still shows; its words and
 * times are written out above and below it.
 */
function FlowList({
  flow,
  teams,
  days,
  folded,
  toggle,
  start,
  end,
  asOf,
  backdrop,
}: {
  flow: IncidentFlowResponse;
  teams: IncidentFlowResponse["teams"];
  days: ReturnType<typeof daysOf>;
  folded: ReadonlySet<string>;
  toggle: (id: string) => void;
  start: number;
  end: number;
  asOf: number;
  /** Day lines, weekend bands and the now line, behind each track. */
  backdrop: { style: CSSProperties; bands: ReactNode; now: ReactNode };
}) {
  const organization = useOrganization();

  return (
    <div role="region" aria-label={`Incidents over the last ${flow.days} days`}>
      {/* One axis for every track: the dates, today's picked out. */}
      <div
        aria-hidden="true"
        className="grid border-b border-(--flow-rule) bg-(--flow-head) px-4 py-1.5"
        style={{ gridTemplateColumns: `repeat(${flow.days}, minmax(0, 1fr))` }}
      >
        {days.map((day) => (
          <span
            key={day.key}
            className={cx(
              "numeric text-center text-[0.6875rem] font-semibold",
              day.key === flow.to ? "text-accent-text" : "text-fg-subtle",
              day.weekend && "bg-[color-mix(in_srgb,transparent_94%,var(--color-fg))]",
            )}
          >
            {day.date}
          </span>
        ))}
      </div>

      {teams.map((group) => {
        const open = !folded.has(group.id);
        const said = flow.scope === "organization" ? teamFigures(group.figures) : null;

        return (
          <div key={group.id} className="border-t border-(--flow-rule) first:border-t-0">
            <div className="flex flex-col gap-0.5 px-2 pt-3 pb-2">
              <TeamToggle group={group} open={open} onToggle={() => toggle(group.id)} />
              {said && <span className="px-2 pl-7.5 text-xs text-fg-subtle">{said}</span>}
            </div>

            {open && group.incidents.length > 0 && (
              <ul className="divide-y divide-(--flow-rule) border-t border-(--flow-rule)">
                {group.incidents.map((incident) => {
                  const key = incidentKey(incident.number);
                  const words = describe(incident, asOf);
                  const phase = phaseOf(incident);

                  return (
                    <li key={incident.number} className="flex flex-col gap-1.5 px-4 py-3">
                      <div className="flex min-w-0 items-baseline gap-2.5">
                        <SeverityMark severity={incident.severity} className="shrink-0 text-xs" />
                        <Link
                          href={incidentHref(organization.slug, incident.number)}
                          aria-label={`${key}, ${incident.title}: ${words}`}
                          className="flex min-w-0 items-baseline gap-2 rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                        >
                          <span className="data shrink-0 text-xs text-fg-subtle">{key}</span>
                          <span className="line-clamp-2 text-sm text-fg">{incident.title}</span>
                        </Link>
                      </div>
                      <p className="flex flex-wrap gap-x-3 text-xs">
                        <span
                          className={cx(
                            "data",
                            phase === "waiting" ? "text-warning-text" : "text-fg-muted",
                          )}
                        >
                          {words}
                        </span>
                        {flow.scope === "organization" && (
                          <span className="text-fg-subtle">
                            {incident.responders === 0
                              ? "no one yet"
                              : `${incident.responders} ${incident.responders === 1 ? "responder" : "responders"}`}
                          </span>
                        )}
                      </p>
                      <div
                        aria-hidden="true"
                        className="relative h-4 overflow-hidden rounded-sm bg-(--flow-strip)"
                        style={backdrop.style}
                      >
                        {backdrop.bands}
                        <Bar
                          incident={incident}
                          start={start}
                          end={end}
                          asOf={asOf}
                          showUpdates={flow.scope === "teams"}
                        />
                        {backdrop.now}
                      </div>
                      <p className="flex flex-wrap gap-x-3 text-xs text-fg-subtle">
                        <span>declared {MOMENT.format(new Date(incident.createdAt))}</span>
                        {incident.resolvedAt && (
                          <span className="text-status-resolved-text">
                            resolved {MOMENT.format(new Date(incident.resolvedAt))}
                          </span>
                        )}
                        {flow.scope === "teams" && incident.yourUpdates.length > 0 && (
                          <span>
                            {incident.yourUpdates.length} of your{" "}
                            {incident.yourUpdates.length === 1 ? "update" : "updates"}
                          </span>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One incident in the table, and the team responsible for it. */
interface FlowRow {
  incident: IncidentFlowItemResponse;
  team: string;
}

/** What a row's bar says, in full, beside the bar. */
function BarTooltip({
  incident,
  asOf,
  share,
  up = false,
}: {
  incident: IncidentFlowItemResponse;
  asOf: number;
  /** Where the bar ends, so the tooltip sits beside it. */
  share: number;
  /** One of the last rows: it opens upward, so nothing below is needed. */
  up?: boolean;
}) {
  const phase = phaseOf(incident);
  // Near the right edge, it sits before the bar's end instead of after it.
  const before = share > 0.62;

  return (
    <div
      aria-hidden="true"
      className={cx(
        "pointer-events-none absolute z-20 w-max rounded-lg border border-(--flow-line) bg-(--flow-bottom) px-3 py-2 text-xs leading-5 shadow-overlay",
        up ? "bottom-0" : "top-1/2 -translate-y-1/2",
        before ? "-translate-x-full -ml-3" : "ml-3",
      )}
      style={{ left: percent(share) }}
    >
      <p className="font-semibold text-fg">
        {incidentKey(incident.number)} · {incident.title}
      </p>
      <p className="flex items-center gap-2 text-fg-muted">
        <span className="h-1.5 w-3 rounded-full" style={{ backgroundColor: WAIT }} />
        {incident.startedAt
          ? `Waited ${formatDuration(incident.waitMs)} before someone started`
          : `Waiting ${formatDuration(incident.waitMs)} · nobody has started`}
      </p>
      {incident.startedAt && (
        <p className="flex items-center gap-2 text-fg-muted">
          <span className="h-1.5 w-3 rounded-full" style={{ backgroundColor: WORKED }} />
          Worked {formatDuration(workMs(incident, asOf))}
          {phase === "working" ? " so far" : ""}
        </p>
      )}
      <p className="flex items-center gap-2 text-fg-muted">
        <span
          className="mx-0.5 size-2 rounded-full"
          style={{ backgroundColor: phase === "resolved" ? "var(--flow-resolved)" : "transparent" }}
        />
        {incident.resolvedAt
          ? `Resolved ${MOMENT.format(new Date(incident.resolvedAt))}`
          : `Declared ${MOMENT.format(new Date(incident.createdAt))} · still open`}
      </p>
    </div>
  );
}

/** The flow itself, once it has arrived. */
function FlowFrame({
  flow,
  team,
}: {
  flow: IncidentFlowResponse;
  /** One team's id, or undefined for every team given. */
  team: string | undefined;
}) {
  const organization = useOrganization();
  const wide = useWide();
  const [pointed, setPointed] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string> | null>(null);

  const start = Date.parse(`${flow.from}T00:00:00.000Z`);
  const end = start + flow.days * DAY_MS;
  const asOf = Date.parse(flow.asOf);
  const now = shareOf(asOf, start, end);
  const days = daysOf(flow.from, flow.days);
  const today = days.findIndex((day) => day.key === flow.to);
  const teams = flow.teams.filter(({ id }) => !team || id === team);
  // One table of every team's incidents, newest first, each with its team.
  const rows: FlowRow[] = teams
    .flatMap(({ name, incidents }) =>
      incidents.map((incident) => ({ incident, team: name })),
    )
    .sort(
      (a, b) => Date.parse(b.incident.createdAt) - Date.parse(a.incident.createdAt),
    );
  // The phone's list still groups by team; a team with nothing on now
  // starts folded where every team is shown, a member's own teams open.
  const folded =
    collapsed ??
    new Set(
      flow.scope === "organization"
        ? flow.teams
            .filter(({ incidents }) => incidents.every(({ resolvedAt }) => resolvedAt))
            .map(({ id }) => id)
        : [],
    );
  const toggle = (id: string) => {
    const next = new Set(folded);

    if (!next.delete(id)) next.add(id);

    setCollapsed(next);
  };
  const dayLines: CSSProperties = {
    backgroundImage:
      "linear-gradient(to right, var(--flow-rule) 1px, transparent 1px)",
    backgroundSize: `${100 / flow.days}% 100%`,
  };
  // Today's column, faintly lit behind every row.
  const todayBand = today >= 0 && (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 bg-[color-mix(in_srgb,transparent_93%,var(--color-accent-text))]"
      style={{ left: percent(today / flow.days), width: percent(1 / flow.days) }}
    />
  );
  const nowLine = (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent-text/60"
      style={{ left: percent(now) }}
    />
  );

  if (rows.length === 0) {
    return (
      <EmptyNote
        className="bg-transparent"
        title={
          flow.scope === "teams"
            ? `No incidents on your teams in the last ${flow.days} days`
            : `No incidents in the last ${flow.days} days`
        }
      >
        Each incident appears here as it is declared, with how long it waited
        for someone to start and how long it was worked.
      </EmptyNote>
    );
  }

  if (!wide) {
    return (
      <>
        <FlowList
          flow={flow}
          teams={teams}
          days={days}
          folded={folded}
          toggle={toggle}
          start={start}
          end={end}
          asOf={asOf}
          backdrop={{ style: dayLines, bands: todayBand, now: nowLine }}
        />
        <Legend scope={flow.scope} asOf={asOf} hint={false} />
      </>
    );
  }

  const columns: CSSProperties = {
    gridTemplateColumns: `minmax(16rem, 24rem) 8rem minmax(${flow.days * 5.5}rem, 1fr)`,
  };
  const head =
    "sticky top-0 flex h-11 items-end border-b border-(--flow-rule) bg-(--flow-head) pb-2 text-xs font-semibold text-fg-muted";

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2 sm:px-5">
        <h3 className="label-caps text-fg-subtle">
          {flow.days === 7 ? "This week" : `Last ${flow.days} days`} ·{" "}
          {rows.length} {rows.length === 1 ? "incident" : "incidents"}
        </h3>
        <span className="text-xs text-fg-subtle">newest first</span>
      </div>
      <div
        role="region"
        aria-label={`Incidents over the last ${flow.days} days`}
        tabIndex={0}
        className="scrollbar-thin max-h-[28rem] overflow-auto border-t border-(--flow-rule) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <div className="grid min-w-max" style={columns}>
          <div className={cx(head, "left-0 z-30 px-4 sm:px-5")}>Incident</div>
          <div className={cx(head, "z-20")}>Team</div>
          <div
            className="sticky top-0 z-20 grid h-11 border-b border-(--flow-rule) bg-(--flow-head)"
            style={{ gridTemplateColumns: `repeat(${flow.days}, minmax(0, 1fr))` }}
          >
            {days.map((day, index) => (
              <span
                key={day.key}
                className={cx(
                  "flex items-end gap-1 border-l border-(--flow-rule) px-2 pb-2 text-xs whitespace-nowrap",
                  index === today
                    ? "bg-[color-mix(in_srgb,transparent_93%,var(--color-accent-text))] font-semibold text-fg"
                    : "text-fg-muted",
                )}
              >
                {day.weekday} {day.date}
                {day.month && <span className="text-fg-subtle">{day.month}</span>}
              </span>
            ))}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 -translate-x-1/2 rounded-sm bg-accent-text px-1.5 text-2xs leading-4 font-bold text-(--flow-bottom)"
              style={{ left: percent(now) }}
            >
              Now
            </span>
          </div>

          {rows.map(({ incident, team: teamName }, index) => {
            const key = incidentKey(incident.number);
            const on = pointed === incident.number;
            const cell = cx(
              "h-9 border-b border-[color-mix(in_srgb,var(--flow-rule)_60%,transparent)]",
              on && "bg-[color-mix(in_srgb,var(--flow-bottom)_88%,var(--color-fg))]",
            );

            return (
              <div
                key={incident.number}
                className="contents"
                onMouseEnter={() => setPointed(incident.number)}
                onMouseLeave={() => setPointed(null)}
              >
                <div
                  className={cx(
                    cell,
                    "sticky left-0 z-10 flex min-w-0 items-center gap-2.5 px-4 sm:px-5",
                    !on && "bg-(--flow-bottom)",
                  )}
                >
                  <SeverityMark severity={incident.severity} className="shrink-0 text-xs" />
                  <Link
                    href={incidentHref(organization.slug, incident.number)}
                    aria-label={`${key}, ${incident.title}, ${teamName}: ${describe(incident, asOf)}`}
                    onFocus={() => setPointed(incident.number)}
                    onBlur={() => setPointed(null)}
                    className="flex min-w-0 items-baseline gap-2 rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span className="data shrink-0 text-xs text-fg-subtle">{key}</span>
                    <span title={incident.title} className="truncate text-sm text-fg">
                      {incident.title}
                    </span>
                  </Link>
                </div>
                <div className={cx(cell, "flex min-w-0 items-center pr-3")}>
                  <TeamTag name={teamName} />
                </div>
                <div className={cx(cell, "relative")} style={dayLines}>
                  {todayBand}
                  {nowLine}
                  <Bar
                    incident={incident}
                    start={start}
                    end={end}
                    asOf={asOf}
                    showUpdates={flow.scope === "teams"}
                  />
                  {on && (
                    <BarTooltip
                      incident={incident}
                      asOf={asOf}
                      share={finishOf(incident, start, end, asOf)}
                      up={rows.length > 2 && index >= rows.length - 2}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Legend scope={flow.scope} asOf={asOf} hint />
    </>
  );
}

/** What each mark means, and on the timeline how to read a row's times. */
function Legend({
  scope,
  asOf,
  hint,
}: {
  scope: IncidentFlowResponse["scope"];
  asOf: number;
  hint: boolean;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-2 border-t border-(--flow-rule) bg-(--flow-strip) px-4 py-2.5 text-xs text-fg-muted sm:px-5">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-4 rounded-full" style={{ backgroundColor: WAIT }} />
        Waiting for someone
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-4 rounded-full" style={{ backgroundColor: WORKED }} />
        Being worked
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full"
          style={{ backgroundColor: "var(--flow-resolved)" }}
        />
        Resolved
      </span>
      {scope === "teams" && (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-fg" />
          Your update
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-0.5 bg-accent-text" />
        Now {CLOCK.format(new Date(asOf))} UTC
      </span>
      {hint && (
        <span className="ml-auto text-fg-subtle">
          Point at an incident for its times · click to open it
        </span>
      )}
    </div>
  );
}

/**
 * The section: its header with the team and range choices, the figures,
 * and the frame. `scope` is what the caller is expected to be answered
 * with — it picks the well's colours before the answer arrives; the
 * answer's own scope decides what is drawn.
 */
export function IncidentFlow({
  scope,
}: {
  scope: IncidentFlowResponse["scope"];
}) {
  const organization = useOrganization();
  const [days, setDays] = useState<Range>(7);
  const [team, setTeam] = useState<string | undefined>(undefined);
  const flow = useIncidentFlow(organization.id, days);
  const data = flow.data;

  // A member on no team has no flow: the page already says why.
  if (data && data.teams.length === 0) return null;

  const shownTeam = team && data?.teams.some(({ id }) => id === team) ? team : undefined;
  const figures =
    (shownTeam && data?.teams.find(({ id }) => id === shownTeam)?.figures) ||
    data?.figures;

  return (
    <section
      aria-labelledby="incident-flow-title"
      className={cx(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface",
        scope === "teams" ? "flow-teams" : "flow-organization",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-thead px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2
              id="incident-flow-title"
              className="text-lg leading-6 font-semibold tracking-[-0.01em] text-fg"
            >
              {scope === "teams" ? "Your teams' incidents" : "Response flow"}
            </h2>
            {/* The time it covers, as each Overview section's label says. */}
            <span className="numeric inline-flex items-center rounded-full border border-line bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">
              Last {days} days
            </span>
          </div>
          <p className="text-sm text-fg-muted">
            {scope === "teams"
              ? "How long each waited for someone to start, and how long it was worked."
              : "Every team's incidents: how long each waited for someone to start, how long it was worked, and when teams were stretched."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {data && data.teams.length > 1 && (
            <FilterGroup label="Team" showLabel={false}>
              {[
                { id: undefined, name: scope === "teams" ? "All your teams" : "All teams" },
                ...data.teams,
              ].map((each) => (
                <FilterOption
                  key={each.id ?? "all"}
                  pressed={shownTeam === each.id}
                  onClick={() => setTeam(each.id)}
                >
                  {each.name}
                </FilterOption>
              ))}
            </FilterGroup>
          )}
          <FilterGroup label="Range" showLabel={false}>
            {RANGES.map((range) => (
              <FilterOption
                key={range}
                pressed={days === range}
                onClick={() => setDays(range)}
              >
                {range} days
              </FilterOption>
            ))}
          </FilterGroup>
        </div>
      </div>
      {flow.isError && !data ? (
        <div className="p-4 sm:p-5">
          <ErrorAlert error={flow.error} />
        </div>
      ) : !data || !figures ? (
        <div className="grid min-h-48 place-items-center">
          <Spinner label="Loading the response flow…" />
        </div>
      ) : (
        <div
          aria-busy={flow.isPlaceholderData}
          className={cx(
            "transition-opacity duration-(--duration-fast)",
            flow.isPlaceholderData && "opacity-60",
          )}
        >
          <Figures figures={figures} />
          {/* The timeline on the ink the Overview's other graphs use. */}
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <div className={cx(INSTRUMENT, "flow-ink overflow-hidden")}>
              <FlowFrame flow={data} team={shownTeam} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
