import type { ReactNode } from "react";

import { EVENT_MARKERS } from "@/components/incidents/event-markers";
import type { EventMarker } from "@/components/incidents/event-markers";
import { SeverityMark } from "@/components/incidents/severity";
import { cx } from "@/components/ui/cx";
import { OnwardLink } from "@/components/ui/onward-link";
import { Section } from "@/components/ui/page";
import { LocalTime } from "@/components/ui/timestamp";
import type {
  IncidentAnalysisResponse,
  IncidentKeyMomentKind,
  IncidentKeyMomentResponse,
  IncidentSeverity,
} from "@/lib/api/contracts";

import { sinceDeclared } from "./analysis-facts";

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

/**
 * The moments that shaped the incident — its declaration, the first
 * response, each change of severity or team, the last response completing,
 * and its resolution — each at its time from the declaration. A selection,
 * not the timeline: no updates, one line each, and the way on to the whole
 * of it.
 */
export function KeyMoments({
  analysis,
  timelineHref,
}: {
  analysis: IncidentAnalysisResponse;
  timelineHref: string;
}) {
  const { keyMoments, facts } = analysis;

  return (
    <Section id="key-moments" title="Key moments" meta={keyMoments.length}>
      {keyMoments.length === 0 ? (
        <p className="text-sm text-fg-muted">No moments were recorded.</p>
      ) : (
        <ol className="flex flex-col">
          {keyMoments.map((moment) => {
            const { Icon, colour } = MOMENT_MARKERS[moment.kind];

            return (
              <li
                key={moment.activityId}
                className="grid grid-cols-[4.75rem_1rem_minmax(0,1fr)] items-start gap-x-2.5 border-b border-line-subtle py-2 last:border-b-0"
              >
                <span className="data pt-px text-right text-fg-muted">
                  {sinceDeclared(facts.declaredAt, moment.at)}
                </span>
                <Icon
                  aria-hidden="true"
                  strokeWidth={2}
                  className={cx("mt-0.5 size-3.5", colour)}
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="flex flex-wrap items-center gap-x-1 text-sm text-fg">
                    {describe(moment)}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {moment.actor.name}
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    <LocalTime value={moment.at} />
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <OnwardLink href={timelineHref}>Full timeline</OnwardLink>
    </Section>
  );
}
