"use client";

import { ArrowRight, Circle, CircleCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  incidentHref,
  useIncidentAttention,
} from "@/components/incidents/incident-queries";
import { incidentKey, SeverityMark } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { Spinner } from "@/components/ui/spinner";
import { stretchedLinkClasses } from "@/components/ui/table";
import { Duration } from "@/components/ui/timestamp";
import type { IncidentDetailResponse } from "@/lib/api/contracts";

import { OverviewPanel } from "./overview-panel";

/**
 * What needs the caller right now: the second thing the Overview answers,
 * straight after the organization's state — "what requires my action?".
 *
 * Current state, not a feed: each list is the API's answer to "what is
 * waiting on me", polled, and an incident leaves it once the work is done
 * elsewhere. Nothing is marked read, and nothing is acted on here — every
 * item links to its incident, where starting, completing, and resolving
 * live.
 *
 * Which parts show follows the caller's permissions, as the API answered
 * them: `manage` gives "Waiting on you", `respond` gives "Your work". Each
 * is a panel of the Overview, framed like the ones above it.
 *
 * Side by side on a wide screen when both are shown, as one pair of action
 * panels; one alone takes the whole width. The grid is drawn here rather
 * than by the page, because only here is it known how many panels there
 * are — the page would have to work the permissions out a second time.
 *
 * Drawn in three strengths, so what needs the caller is seen first:
 *
 *   pending  work waiting for someone to act — ready to resolve, a team
 *            needing a responder: the accent surface and edge
 *   current  the caller's own investigations: the accent edge on the
 *            plain surface
 *   empty    one quiet line, no frame
 *
 * The glyphs are the lifecycle's own — a teal check for response work
 * complete, a crimson open circle for not started, the blue dot for
 * investigating — so a state reads the same wherever it is drawn. The
 * accent is left to what asks for a decision: the frame and the cue.
 */
export function OperationalAttention() {
  const organization = useOrganization();
  const attention = useIncidentAttention(organization.id);

  if (attention.isError && !attention.data) {
    return <ErrorAlert error={attention.error} />;
  }
  if (!attention.data) return <Spinner label="Loading what needs you…" />;

  const { manage, respond } = attention.data;
  // Whoever also manages is shown their own work only when it holds
  // something: an admin on no team would see two lists that never fill.
  const showWork =
    respond !== null &&
    (manage === null ||
      respond.needsYourTeam.length + respond.yourResponses.length > 0);

  if (!manage && !showWork) return null;

  const both = manage !== null && showWork;

  const workGroups: GroupProps[] = respond
    ? [
        {
          id: "needs-your-team",
          title: "Needs your team",
          strength: "pending",
          incidents: respond.needsYourTeam,
          empty: "No team incidents need picking up.",
          cue: "Open",
          row: (incident) => ({
            headline: (
              <>
                <Circle
                  aria-hidden="true"
                  strokeWidth={2.25}
                  className="size-3.5 text-status-declared-text"
                />
                {incident.team.name} needs a responder
              </>
            ),
            detail: <NotStarted incident={incident} />,
          }),
        },
        {
          id: "your-active-responses",
          title: "Your active responses",
          strength: "current",
          incidents: respond.yourResponses,
          empty: "You have no active responses.",
          cue: "Open",
          row: (incident) => ({
            headline: (
              <>
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-status-investigating-text"
                />
                You are investigating
              </>
            ),
            detail: <Investigating incident={incident} />,
          }),
        },
      ]
    : [];

  // Stable: a group with work comes before one without.
  workGroups.sort(
    (a, b) =>
      Number(a.incidents.length === 0) - Number(b.incidents.length === 0),
  );

  return (
    // Its children are the panels themselves — no wrapper between — so
    // each is a cell of this grid. Two columns only when there are two; one
    // otherwise, sized to the page (`minmax(0, 1fr)`) rather than to its
    // content, so a long title truncates instead of widening the page.
    <div className={cx("grid grid-cols-1 gap-6", both && "2xl:grid-cols-2")}>
      {manage && (
        <OverviewPanel
          id="waiting-on-you"
          title="Waiting on you"
          // The one frame that says "act" — and only while there is
          // something to act on. Your work stays a plain section: work
          // under way, not a decision.
          tone={manage.readyToResolve.length > 0 ? "action" : "default"}
          // How much is waiting, where the other panels say what period
          // they cover — solid, as the header's one strong cue. Nothing
          // waiting is said by the line inside, not by a nought here.
          label={
            manage.readyToResolve.length > 0 ? (
              <span className="numeric inline-flex min-w-5 items-center justify-center rounded-full border border-status-resolved-text bg-status-resolved-solid px-1.5 py-0.5 text-xs font-semibold text-on-accent">
                {manage.readyToResolve.length}
              </span>
            ) : undefined
          }
          description="Incidents that need your decision to move forward."
        >
          <AttentionGroup
            id="ready-to-resolve"
            title="Ready to resolve"
            strength="resolve"
            incidents={manage.readyToResolve}
            empty="Nothing is waiting for your action."
            cue="Review"
            row={(incident) => ({
              headline: (
                <>
                  <CircleCheck
                    aria-hidden="true"
                    strokeWidth={2.25}
                    className="size-3.5 text-status-resolved-text"
                  />
                  Response work complete — ready to resolve
                </>
              ),
              detail: <ResponseComplete incident={incident} />,
            })}
          />
        </OverviewPanel>
      )}
      {showWork && (
        <OverviewPanel
          id="your-work"
          title="Your work"
          // No label: each group already carries its own count, and two
          // numbers in one header would say nothing the lists do not.
          description="What your teams need picked up, and what you are working on."
        >
          {/* Closer than the panel's own rhythm: these are two halves of
              one question, not two sections. */}
          <div className="flex flex-col gap-5">
            {workGroups.map((group) => (
              <AttentionGroup key={group.id} {...group} />
            ))}
          </div>
        </OverviewPanel>
      )}
    </div>
  );
}

type Strength = "resolve" | "pending" | "current";

/** The list's frame, by how much it asks of the caller. */
const FRAMES: Record<Strength, string> = {
  // Ready to resolve: the resolved teal's surface, with no border — the
  // tint alone says which decision it waits on: the one that closes an
  // incident.
  resolve: "bg-status-resolved-subtle divide-status-resolved-line",
  // Someone needs to act: the accent surface, and its edge.
  pending:
    "border-accent-line border-l-accent-mark bg-accent-subtle divide-accent-line",
  // Under way: the edge alone, on the plain surface.
  current: "border-line border-l-accent-mark bg-surface divide-line-subtle",
};

/** The frame's own colour, for its count, its cue and a hovered title. */
const CUES: Record<Strength, { text: string; hover: string }> = {
  resolve: {
    text: "text-status-resolved-text",
    hover: "group-hover/row:text-status-resolved-text",
  },
  pending: {
    text: "text-accent-text",
    hover: "group-hover/row:text-accent-text",
  },
  current: {
    text: "text-accent-text",
    hover: "group-hover/row:text-accent-text",
  },
};

interface GroupProps {
  id: string;
  title: string;
  strength: Strength;
  incidents: IncidentDetailResponse[];
  empty: string;
  /** The visible word for following a row's link. */
  cue: string;
  /** What is needed, in words, and why — for one incident. */
  row: (incident: IncidentDetailResponse) => {
    headline: ReactNode;
    detail: ReactNode;
  };
}

/**
 * One list, headed by its name and count. With incidents, it is framed by
 * its strength; empty, it is its heading and one quiet line, so it never
 * competes with a list that holds work.
 */
function AttentionGroup({
  id,
  title,
  strength,
  incidents,
  empty,
  cue,
  row,
}: GroupProps) {
  if (incidents.length === 0) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 id={`${id}-title`} className="text-sm font-medium text-fg-muted">
          {title}
        </h3>
        <p className="text-sm text-fg-subtle">{empty}</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 id={`${id}-title`} className="text-sm font-semibold text-fg">
          {title}
        </h3>
        <span className={cx("numeric text-sm font-semibold", CUES[strength].text)}>
          {incidents.length}
        </span>
      </div>
      <ul
        aria-labelledby={`${id}-title`}
        className={cx(
          "divide-y overflow-hidden rounded-md",
          strength !== "resolve" && "border border-l-[3px]",
          FRAMES[strength],
        )}
      >
        {incidents.map((incident) => (
          <AttentionRow
            key={incident.id}
            incident={incident}
            strength={strength}
            cue={cue}
            {...row(incident)}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * One incident, read top to bottom: what is needed, in words; the incident
 * — severity, number, title — whose link stretches over the row; then why,
 * and for how long. The cue on the right is the link's affordance, not a
 * second control.
 */
function AttentionRow({
  incident,
  strength,
  cue,
  headline,
  detail,
}: {
  incident: IncidentDetailResponse;
  strength: Strength;
  cue: string;
  headline: ReactNode;
  detail: ReactNode;
}) {
  const organization = useOrganization();

  return (
    <li
      className={cx(
        "group/row relative flex items-center gap-4 px-4 py-3.5 transition-colors duration-(--duration-fast) has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus",
        strength === "current" ? "hover:bg-hover" : "hover:bg-surface",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg">
          {headline}
        </p>
        <div className="flex min-w-0 items-center gap-3">
          <SeverityMark
            severity={incident.severity}
            emphasis
            className="shrink-0 text-sm"
          />
          <Link
            href={incidentHref(organization.slug, incident.number)}
            className={cx(
              "flex min-w-0 items-baseline gap-2 underline-offset-2",
              stretchedLinkClasses,
            )}
          >
            <span className="data shrink-0 text-sm text-fg-muted">
              {incidentKey(incident.number)}
            </span>{" "}
            <span
              title={incident.title}
              className={cx(
                "truncate text-[0.9375rem] font-medium text-fg group-hover/row:underline",
                CUES[strength].hover,
              )}
            >
              {incident.title}
            </span>
          </Link>
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-muted">
          {detail}
        </p>
      </div>
      <span
        aria-hidden="true"
        className={cx(
          "hidden shrink-0 items-center gap-1 text-sm font-medium sm:inline-flex",
          CUES[strength].text,
        )}
      >
        {cue}
        <ArrowRight className="size-3.5" />
      </span>
    </li>
  );
}

const Dot = () => (
  <span aria-hidden="true" className="text-fg-subtle">
    ·
  </span>
);

/** Who finished last, and when, so the item says what changed. */
function ResponseComplete({ incident }: { incident: IncidentDetailResponse }) {
  const last = incident.responders
    .filter(({ completedAt }) => completedAt !== null)
    .reduce<IncidentDetailResponse["responders"][number] | undefined>(
      (latest, responder) =>
        !latest || responder.completedAt! > latest.completedAt!
          ? responder
          : latest,
      undefined,
    );
  const count = incident.responders.length;

  return (
    <>
      {last?.completedAt && (
        <>
          <span>
            {count > 1
              ? `${count} responders finished, last ${last.name}`
              : `${last.name} finished`}{" "}
            <span className="data">
              <Duration from={last.completedAt} />
            </span>{" "}
            ago
          </span>
          <Dot />
        </>
      )}
      <span>{incident.team.name}</span>
    </>
  );
}

/** Nobody on the team has started; how long the incident has been open. */
function NotStarted({ incident }: { incident: IncidentDetailResponse }) {
  return (
    <>
      <span>No one has started investigating this incident.</span>
      <Dot />
      <span>
        Open{" "}
        <span className="data">
          <Duration from={incident.createdAt} />
        </span>
      </span>
    </>
  );
}

/** The caller's own response, and how long they have been on it. */
function Investigating({ incident }: { incident: IncidentDetailResponse }) {
  const organization = useOrganization();
  const own = incident.responders.find(
    ({ membershipId }) => membershipId === organization.membership.id,
  );

  return (
    <>
      {own && (
        <>
          <span>
            Started{" "}
            <span className="data">
              <Duration from={own.startedAt} />
            </span>{" "}
            ago
          </span>
          <Dot />
        </>
      )}
      <span>{incident.team.name}</span>
    </>
  );
}
