import { useId } from "react";
import type { ReactNode } from "react";

import { EVENT_MARKERS } from "@/components/incidents/event-markers";
import type { EventMarker } from "@/components/incidents/event-markers";
import { SeverityMark } from "@/components/incidents/severity";
import { cx } from "@/components/ui/cx";
import { OnwardLink } from "@/components/ui/onward-link";
import { formatDuration, LocalTime } from "@/components/ui/timestamp";
import type {
  IncidentAnalysisResponse,
  IncidentKeyMomentKind,
  IncidentKeyMomentResponse,
  IncidentSeverity,
} from "@/lib/api/contracts";

import { between, lasted, sinceDeclared } from "./analysis-facts";

/** Each kind of key moment, drawn as the timeline draws its event. */
const MOMENT_MARKERS: Record<IncidentKeyMomentKind, EventMarker> = {
  DECLARED: EVENT_MARKERS.declared,
  FIRST_RESPONSE: EVENT_MARKERS.responseStarted,
  SEVERITY_CHANGED: EVENT_MARKERS.severityChanged,
  TEAM_CHANGED: EVENT_MARKERS.teamChanged,
  LAST_RESPONSE_COMPLETED: EVENT_MARKERS.responseCompleted,
  RESOLVED: EVENT_MARKERS.resolved,
};

/** A change from one value to another: the arrow is drawn, "to" is read. */
function Change({ from, to }: { from: ReactNode; to: ReactNode }) {
  return (
    <>
      {from}
      <span aria-hidden="true" className="text-fg-subtle">
        {" "}
        →{" "}
      </span>
      <span className="sr-only"> to </span>
      {to}
    </>
  );
}

/** What a moment meant, in a few words. */
function describe(moment: IncidentKeyMomentResponse): ReactNode {
  const severity = (value: string | null) =>
    value && <SeverityMark severity={value as IncidentSeverity} />;

  switch (moment.kind) {
    case "DECLARED":
      return (
        <>
          Declared{moment.toValue && " at "}
          {severity(moment.toValue)}
        </>
      );
    case "FIRST_RESPONSE":
      return "First response";
    case "SEVERITY_CHANGED":
      return (
        <>
          Severity{" "}
          <Change from={severity(moment.fromValue)} to={severity(moment.toValue)} />
        </>
      );
    case "TEAM_CHANGED":
      return (
        <>
          Reassigned{" "}
          <Change
            from={<span className="font-medium">{moment.fromValue}</span>}
            to={<span className="font-medium">{moment.toValue}</span>}
          />
        </>
      );
    case "LAST_RESPONSE_COMPLETED":
      return "Last response completed";
    case "RESOLVED":
      return <span className="font-semibold">Resolved</span>;
    default:
      return null;
  }
}

/** Markers this close on the track, as a share of it, are nudged apart. */
const MIN_GAP = 4;

/**
 * Where each moment sits on the track, as a percentage of the incident's
 * length — nudged apart where two would touch, so each marker shows.
 */
const placeOnTrack = (
  facts: IncidentAnalysisResponse["facts"],
  moments: readonly IncidentKeyMomentResponse[],
) => {
  const length = Math.max(1, between(facts.declaredAt, facts.resolvedAt));
  const places = moments.map(
    (moment) => (between(facts.declaredAt, moment.at) / length) * 100,
  );

  for (let index = 1; index < places.length; index += 1) {
    places[index] = Math.max(places[index], places[index - 1] + MIN_GAP);
  }
  for (let index = places.length - 1; index >= 0; index -= 1) {
    places[index] = Math.min(places[index], 100 - (places.length - 1 - index) * MIN_GAP);
  }

  return places.map((place) => Math.max(0, place));
};

type Phase = { label: string; ms: number; colour: string; swatch: string };

/**
 * The incident's three stretches: waiting for someone to start, the work,
 * and the wait to be resolved once the work was done. Measured from the
 * facts and the last response's completion; a stretch that did not happen
 * is left out.
 */
const phasesOf = (analysis: IncidentAnalysisResponse): Phase[] => {
  const { facts, keyMoments } = analysis;
  const lastDone = keyMoments.findLast(({ kind }) => kind === "LAST_RESPONSE_COMPLETED")?.at;

  if (facts.firstResponseAt === null) {
    return [
      {
        label: "with no response",
        ms: lasted(facts),
        colour: "text-warning-text",
        swatch: "bg-warning-text",
      },
    ];
  }

  return [
    {
      label: "to first response",
      ms: between(facts.declaredAt, facts.firstResponseAt),
      colour: "text-warning-text",
      swatch: "bg-warning-text",
    },
    {
      label: "worked",
      ms: between(facts.firstResponseAt, lastDone ?? facts.resolvedAt),
      colour: "text-status-investigating-text",
      swatch: "bg-status-investigating-text",
    },
    ...(lastDone
      ? [
          {
            label: "to resolve",
            ms: between(lastDone, facts.resolvedAt),
            colour: "text-status-resolved-text",
            swatch: "bg-status-resolved-text",
          },
        ]
      : []),
  ];
};

/**
 * The moments that shaped the incident — its declaration, the first
 * response, each change of severity or team, the last response completing,
 * and its resolution. A selection, not the timeline: no updates, and the way
 * on to the whole of it.
 *
 * Drawn twice over, each part doing one job. The track is to scale: its
 * stretches show how the time went, named in the legend above it, and each
 * moment is a numbered marker on it. The words are in numbered cards
 * beneath, evenly spaced, so two moments close together never crowd each
 * other's labels.
 */
export function KeyMoments({
  analysis,
  timelineHref,
}: {
  analysis: IncidentAnalysisResponse;
  timelineHref: string;
}) {
  const headingId = useId();
  const { keyMoments, facts } = analysis;
  const phases = phasesOf(analysis);
  const total = phases.reduce((sum, phase) => sum + phase.ms, 0) || 1;
  const places = placeOnTrack(facts, keyMoments);

  return (
    <section
      id="key-moments"
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface px-4.5 py-4 sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <h3 id={headingId} className="label-caps text-fg-subtle">
          Key moments{" "}
          <span className="data tracking-normal normal-case">
            · {formatDuration(lasted(facts))} in all
          </span>
        </h3>
        <ul
          aria-label="How the time went"
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted"
        >
          {phases.map((phase) => (
            <li key={phase.label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cx("h-1 w-3.5 rounded-full", phase.swatch)} />
              <span className={cx("data", phase.colour)}>{formatDuration(phase.ms)}</span>
              {phase.label}
            </li>
          ))}
        </ul>
        <OnwardLink href={timelineHref}>Full timeline</OnwardLink>
      </div>

      {keyMoments.length === 0 ? (
        <p className="text-sm text-fg-muted">No moments were recorded.</p>
      ) : (
        <>
          <div aria-hidden="true" className="relative mx-3.5 h-7">
            <span className="absolute inset-x-0 top-3 flex h-1 overflow-hidden rounded-full">
              {phases.map((phase) => (
                <span
                  key={phase.label}
                  className={phase.swatch}
                  style={{ width: `${(phase.ms / total) * 100}%` }}
                />
              ))}
            </span>
            {keyMoments.map((moment, index) => (
              <span
                key={moment.activityId}
                className={cx(
                  "data absolute top-0 grid size-7 -translate-x-1/2 place-items-center rounded-full border-2 border-current bg-surface text-[0.6875rem] font-semibold",
                  MOMENT_MARKERS[moment.kind].colour,
                )}
                style={{ left: `${places[index]}%` }}
              >
                {index + 1}
              </span>
            ))}
          </div>
          <ol aria-label="Moments" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {keyMoments.map((moment, index) => {
              const { colour } = MOMENT_MARKERS[moment.kind];
              const resolved = moment.kind === "RESOLVED";

              return (
                <li
                  key={moment.activityId}
                  className={cx(
                    "flex gap-2.5 rounded-lg border px-3.5 py-3",
                    resolved
                      ? "border-status-resolved-line bg-status-resolved-subtle/50"
                      : "border-line bg-sunken/50",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      "data grid size-5.5 shrink-0 place-items-center rounded-full border-[1.5px] border-current text-[0.625rem] font-semibold",
                      colour,
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-1 text-sm font-semibold text-fg">
                      {describe(moment)}
                    </span>
                    <span className="text-xs text-fg-muted">{moment.actor.name}</span>
                    <span className="data text-[0.6875rem] text-fg-subtle">
                      {sinceDeclared(facts.declaredAt, moment.at)}
                      <span aria-hidden="true"> · </span>
                      <span className="sr-only">, </span>
                      <LocalTime value={moment.at} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
