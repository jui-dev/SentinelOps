"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";

import { FilterChip } from "@/components/incidents/incident-filters";
import {
  incidentHref,
  LIVE_POLL_MS,
} from "@/components/incidents/incident-queries";
import { incidentKey, SeverityMark } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { Spinner } from "@/components/ui/spinner";
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
 * Drawn in a well of its own, teal-black for a member's teams and
 * blue-black for every team (see `flow-teams` and `flow-organization` in
 * globals.css), in a frame of fixed size: past what fits, it scrolls inside
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

/** One figure above the frame, with a mark matching what it measures. */
function Figure({
  label,
  value,
  note,
  mark,
  noteTone,
}: {
  label: string;
  value: string;
  note?: string;
  mark: CSSProperties;
  noteTone?: "warning";
}) {
  return (
    // The term and its value are the group's own children, as a <dl> asks;
    // the mark sits in the term, at the group's leading edge.
    <div className="relative flex min-w-0 flex-col gap-0.5 py-3.5 pr-4 pl-8 sm:pr-5 sm:pl-9">
      <dt className="text-xs text-fg-muted">
        <span
          aria-hidden="true"
          className="absolute inset-y-3.5 left-4 w-1 rounded-full sm:left-5"
          style={mark}
        />
        {label}
      </dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        <span className="numeric text-xl font-semibold text-fg">{value}</span>
        {note && (
          <span
            className={cx(
              "text-xs",
              noteTone === "warning" ? "text-warning-text" : "text-fg-subtle",
            )}
          >
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}

const STRIPES: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--color-flow-wait) 0 3px, var(--color-flow-wait-gap) 3px 6px)",
};

const WORKED: CSSProperties = { backgroundColor: "var(--color-flow-declared)" };

function Figures({
  figures,
  scope,
}: {
  figures: IncidentFlowFiguresResponse;
  scope: IncidentFlowResponse["scope"];
}) {
  const most = figures.mostAtOnce;

  return (
    <dl
      aria-label="Response flow figures"
      className="grid grid-cols-1 divide-y divide-(--flow-rule) border-b border-(--flow-rule) bg-(--flow-strip) sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
      <Figure
        label="Typical wait before someone starts"
        value={
          figures.typicalWaitMs === null ? "—" : formatDuration(figures.typicalWaitMs)
        }
        note={
          figures.started > 0
            ? `median of ${figures.started} started`
            : "nothing started yet"
        }
        mark={STRIPES}
      />
      <Figure
        label="Most running at once"
        value={most ? String(most.count) : "—"}
        note={most ? `from ${MOMENT.format(new Date(most.at))}` : undefined}
        mark={WORKED}
      />
      {scope === "teams" ? (
        <Figure
          label="Waiting right now"
          value={String(figures.waitingNow)}
          note={figures.waitingNow > 0 ? "nobody has started" : "none"}
          noteTone={figures.waitingNow > 0 ? "warning" : undefined}
          mark={{ backgroundColor: "var(--color-flow-wait)" }}
        />
      ) : (
        <Figure
          label="Longest wait"
          value={figures.longestWait ? formatDuration(figures.longestWait.ms) : "—"}
          note={
            figures.longestWait
              ? `${incidentKey(figures.longestWait.number)}${figures.longestWait.waiting ? " · still waiting" : ""}`
              : undefined
          }
          noteTone={figures.longestWait?.waiting ? "warning" : undefined}
          mark={{ backgroundColor: "var(--color-flow-wait)" }}
        />
      )}
    </dl>
  );
}

/** The bar for one incident, and the words beside it. */
function Bar({
  incident,
  start,
  end,
  asOf,
  showUpdates,
  words = true,
}: {
  incident: IncidentFlowItemResponse;
  start: number;
  end: number;
  asOf: number;
  showUpdates: boolean;
  /** Whether the words go beside the bar; the list says them above it. */
  words?: boolean;
}) {
  const declared = Date.parse(incident.createdAt);
  const started = incident.startedAt ? Date.parse(incident.startedAt) : null;
  const resolved = incident.resolvedAt ? Date.parse(incident.resolvedAt) : null;
  const phase = phaseOf(incident);

  const from = shareOf(declared, start, end);
  const waitEnd = shareOf(started ?? resolved ?? asOf, start, end);
  const workEnd = shareOf(resolved ?? asOf, start, end);
  const finish = started ? workEnd : waitEnd;
  // Near the right edge, the words go before the bar instead of after it.
  const wordsFirst = finish > 0.7;

  return (
    <>
      <span
        aria-hidden="true"
        className={cx(
          "absolute top-1/2 h-2.5 min-w-1.5 -translate-y-1/2 rounded-l-sm",
          !started && "rounded-r-sm",
          phase === "waiting" && "shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-flow-wait)_18%,transparent)]",
        )}
        style={{
          ...STRIPES,
          left: percent(from),
          width: percent(Math.max(0, waitEnd - from)),
        }}
      />
      {started !== null && (
        <span
          aria-hidden="true"
          className={cx(
            "absolute top-1/2 h-2.5 min-w-1.5 -translate-y-1/2",
            phase === "resolved" ? "rounded-r-sm" : "",
          )}
          style={{
            ...WORKED,
            left: percent(waitEnd),
            width: percent(Math.max(0, workEnd - waitEnd)),
            ...(phase === "resolved"
              ? { boxShadow: "inset -3px 0 0 var(--flow-resolved)" }
              : {
                  backgroundImage:
                    "linear-gradient(90deg, transparent 70%, color-mix(in srgb, var(--color-flow-declared) 30%, transparent))",
                }),
          }}
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
      {words && (
        <span
          aria-hidden="true"
          className={cx(
            "data absolute top-1/2 -translate-y-1/2 text-xs whitespace-nowrap",
            phase === "waiting" ? "text-warning-text" : "text-fg-subtle",
            wordsFirst ? "-translate-x-full pr-2" : "pl-2",
          )}
          style={{ left: percent(wordsFirst ? from : finish) }}
        >
          {describe(incident, asOf)}
        </span>
      )}
    </>
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
                          words={false}
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
  const [pointed, setPointed] = useState<IncidentFlowItemResponse | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string> | null>(null);

  const start = Date.parse(`${flow.from}T00:00:00.000Z`);
  const end = start + flow.days * DAY_MS;
  const asOf = Date.parse(flow.asOf);
  const now = shareOf(asOf, start, end);
  const days = daysOf(flow.from, flow.days);
  const teams = flow.teams.filter(({ id }) => !team || id === team);
  // A team with nothing on now starts folded where every team is shown;
  // a member's own teams start open.
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
  const columns: CSSProperties = {
    gridTemplateColumns: `minmax(15rem, 22rem) minmax(${flow.days * 5.5}rem, 1fr)`,
  };
  const dayLines: CSSProperties = {
    backgroundImage:
      "linear-gradient(to right, var(--flow-rule) 1px, transparent 1px)",
    backgroundSize: `${100 / flow.days}% 100%`,
  };
  // The weekend — Friday and Saturday (lib/period/week.ts) — faintly banded
  // behind every row. Incidents happen then like any other day and are drawn
  // in full; the band only says when one landed outside the working week,
  // where a long wait for a first responder is worth noticing.
  const weekendBands = days.map(
    (day, index) =>
      day.weekend && (
        <span
          key={day.key}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 bg-[color-mix(in_srgb,transparent_94%,var(--color-fg))]"
          style={{ left: percent(index / flow.days), width: percent(1 / flow.days) }}
        />
      ),
  );
  const nowLine = (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent-text"
      style={{ left: percent(now) }}
    />
  );

  if (teams.every(({ incidents }) => incidents.length === 0)) {
    return (
      <p className="px-4 py-10 text-center text-sm text-fg-muted sm:px-5">
        {flow.scope === "teams"
          ? `No incidents on your teams in the last ${flow.days} days.`
          : `No incidents in the last ${flow.days} days.`}
      </p>
    );
  }

  const legend = (
    <Legend scope={flow.scope} asOf={asOf} hint={wide} />
  );

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
          backdrop={{ style: dayLines, bands: weekendBands, now: nowLine }}
        />
        {legend}
      </>
    );
  }

  return (
    <>
      <div
        role="region"
        aria-label={`Incidents over the last ${flow.days} days`}
        tabIndex={0}
        className="scrollbar-thin max-h-[26rem] overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <div className="grid min-w-max" style={columns}>
          {/* The axis: pinned above, its corner pinned both ways. */}
          <div className="sticky top-0 left-0 z-30 flex items-end border-b border-(--flow-rule) bg-(--flow-head) px-4 pb-2 text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase sm:px-5">
            Incident
          </div>
          <div
            className="sticky top-0 z-20 grid h-11 border-b border-(--flow-rule) bg-(--flow-head)"
            style={{ gridTemplateColumns: `repeat(${flow.days}, minmax(0, 1fr))` }}
          >
            {days.map((day) => {
              const today = day.key === flow.to;

              return (
                <span
                  key={day.key}
                  className={cx(
                    "flex items-end gap-1 border-l border-(--flow-rule) px-2 pb-2",
                    day.weekend &&
                      "bg-[color-mix(in_srgb,transparent_94%,var(--color-fg))]",
                  )}
                >
                  <span
                    className={cx(
                      "text-[0.6875rem] font-semibold tracking-wide uppercase",
                      today ? "text-accent-text" : "text-fg-subtle",
                    )}
                  >
                    {day.weekday}
                  </span>
                  <span
                    className={cx(
                      "numeric text-sm font-semibold",
                      today ? "text-fg" : "text-fg-muted",
                    )}
                  >
                    {day.date}
                    {day.month && (
                      <span className="ml-1 text-xs font-normal text-fg-subtle">
                        {day.month}
                      </span>
                    )}
                  </span>
                </span>
              );
            })}
          </div>

          {teams.map((group) => {
            const open = !folded.has(group.id);
            const said = flow.scope === "organization" ? teamFigures(group.figures) : null;

            return (
              <div key={group.id} className="contents">
                <div className="sticky left-0 z-10 border-t border-(--flow-rule) bg-(--flow-bottom) px-2 pt-3 pb-1.5">
                  <TeamToggle group={group} open={open} onToggle={() => toggle(group.id)} />
                </div>
                <div className="relative border-t border-(--flow-rule) pt-3 pb-1.5" style={dayLines}>
                  {said && (
                    <span className="block px-3 text-right text-xs text-fg-subtle">{said}</span>
                  )}
                  {weekendBands}
                  {nowLine}
                </div>

                {open &&
                  group.incidents.map((incident) => {
                    const key = incidentKey(incident.number);
                    const words = describe(incident, asOf);

                    return (
                      <div
                        key={incident.number}
                        className="group/row contents"
                        onMouseEnter={() => setPointed(incident)}
                        onMouseLeave={() => setPointed(null)}
                      >
                        <div className="sticky left-0 z-10 flex h-10 min-w-0 items-center gap-2.5 bg-(--flow-bottom) px-4 group-hover/row:bg-[color-mix(in_srgb,var(--flow-bottom)_88%,var(--color-fg))] sm:px-5">
                          <SeverityMark severity={incident.severity} className="shrink-0 text-xs" />
                          <Link
                            href={incidentHref(organization.slug, incident.number)}
                            aria-label={`${key}, ${incident.title}: ${words}`}
                            onFocus={() => setPointed(incident)}
                            onBlur={() => setPointed(null)}
                            className="flex min-w-0 items-baseline gap-2 rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                          >
                            <span className="data shrink-0 text-xs text-fg-subtle">{key}</span>
                            <span title={incident.title} className="truncate text-sm text-fg">
                              {incident.title}
                            </span>
                          </Link>
                          {flow.scope === "organization" && (
                            <span className="ml-auto shrink-0 text-xs text-fg-subtle">
                              {incident.responders === 0
                                ? "no one yet"
                                : `${incident.responders} ${incident.responders === 1 ? "responder" : "responders"}`}
                            </span>
                          )}
                        </div>
                        <div
                          className="relative h-10 group-hover/row:bg-[color-mix(in_srgb,transparent_92%,var(--color-fg))]"
                          style={dayLines}
                        >
                          {weekendBands}
                          <Bar
                            incident={incident}
                            start={start}
                            end={end}
                            asOf={asOf}
                            showUpdates={flow.scope === "teams"}
                          />
                          {nowLine}
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-2 border-t border-(--flow-rule) bg-(--flow-strip) px-4 py-2.5 text-xs text-fg-muted sm:px-5">
        {pointed ? (
          <p aria-live="polite" className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="font-semibold text-fg">
              {incidentKey(pointed.number)} · {pointed.title}
            </span>
            <span>declared {MOMENT.format(new Date(pointed.createdAt))}</span>
            {pointed.startedAt && (
              <span>first started {CLOCK.format(new Date(pointed.startedAt))}</span>
            )}
            <span className={phaseOf(pointed) === "waiting" ? "text-warning-text" : ""}>
              {describe(pointed, asOf)}
            </span>
            {pointed.resolvedAt && (
              <span className="text-status-resolved-text">
                resolved {MOMENT.format(new Date(pointed.resolvedAt))}
              </span>
            )}
            {flow.scope === "teams" && pointed.yourUpdates.length > 0 && (
              <span>
                {pointed.yourUpdates.length} of your updates
              </span>
            )}
          </p>
        ) : (
          legend
        )}
      </div>
    </>
  );
}

/** What each mark means; on the timeline, also how to read a row's times. */
function Legend({
  scope,
  asOf,
  hint,
}: {
  scope: IncidentFlowResponse["scope"];
  asOf: number;
  hint: boolean;
}) {
  const marks = (
    <>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-5 rounded-xs" style={STRIPES} />
        Waiting for someone to start
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-5 rounded-xs" style={WORKED} />
        Being worked
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-2.5 w-5 rounded-xs"
          style={{ ...WORKED, boxShadow: "inset -3px 0 0 var(--flow-resolved)" }}
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
    </>
  );

  if (hint) {
    return (
      <>
        {marks}
        <span className="ml-auto text-fg-subtle">
          Point at an incident for its times · select it to open
        </span>
      </>
    );
  }

  // The list stands alone, so its legend brings its own strip.
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-(--flow-rule) bg-(--flow-strip) px-4 py-2.5 text-xs text-fg-muted">
      {marks}
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
        "flex min-w-0 flex-col overflow-hidden rounded-xl border border-(--flow-rim) shadow-[0_12px_32px_rgb(0_0_0/0.25)]",
        scope === "teams" ? "flow-teams" : "flow-organization",
      )}
      style={{
        backgroundImage: "linear-gradient(180deg, var(--flow-top), var(--flow-bottom))",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-(--flow-rule) bg-(--flow-head) px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="incident-flow-title" className="text-base font-semibold text-fg">
            {scope === "teams" ? "Your teams' incidents" : "Response flow"}
          </h2>
          <p className="text-sm text-fg-muted">
            {scope === "teams"
              ? "How long each waited for someone to start, and how long it was worked."
              : "Every team's incidents: how long each waited for someone to start, how long it was worked, and when teams were stretched."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {data && data.teams.length > 1 && (
            <div role="group" aria-label="Team" className="flex flex-wrap gap-1.5">
              <FilterChip pressed={!shownTeam} onClick={() => setTeam(undefined)}>
                {scope === "teams" ? "All your teams" : "All teams"}
              </FilterChip>
              {data.teams.map((each) => (
                <FilterChip
                  key={each.id}
                  pressed={shownTeam === each.id}
                  onClick={() => setTeam(shownTeam === each.id ? undefined : each.id)}
                >
                  {each.name}
                </FilterChip>
              ))}
            </div>
          )}
          <div
            role="group"
            aria-label="Range"
            className="flex rounded-lg border border-(--flow-line) bg-(--flow-strip) p-0.5"
          >
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                aria-pressed={days === range}
                onClick={() => setDays(range)}
                className={cx(
                  "h-7 rounded-md px-3 text-sm transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-focus",
                  days === range
                    ? "bg-accent text-on-accent"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {range} days
              </button>
            ))}
          </div>
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
          <Figures figures={figures} scope={data.scope} />
          <FlowFrame flow={data} team={shownTeam} />
        </div>
      )}
    </section>
  );
}
