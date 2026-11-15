"use client";

import { ArrowRight, Check, CircleCheck, UserCheck, Users } from "lucide-react";
import Link from "next/link";

import {
  incidentHref,
  useIncidentAttention,
} from "@/components/incidents/incident-queries";
import { incidentKey, SeverityMark } from "@/components/incidents/severity";
import { useCan, useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { ButtonContent, buttonClasses } from "@/components/ui/button";
import type { ButtonIcon, ButtonVariant } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Spinner } from "@/components/ui/spinner";
import { stretchedLinkClasses } from "@/components/ui/table";
import { Duration, useMinuteClock } from "@/components/ui/timestamp";
import { Permission } from "@/lib/api/contracts";
import type { IncidentDetailResponse } from "@/lib/api/contracts";

import { OverviewPanel } from "./overview-panel";

/**
 * What needs the caller right now: the second thing the Overview answers,
 * straight after the organization's state — "what requires my action?".
 *
 * Current state, not a feed: each list is the API's answer to "what is
 * waiting on me", polled, and an incident leaves it once the work is done
 * elsewhere. Nothing is marked read, and nothing is acted on here — every
 * row links to its incident, where starting, completing, and resolving
 * live.
 *
 * Which parts show follows the caller's permissions, as the API answered
 * them: `manage` gives "Waiting on you" — who should respond, and what is
 * ready to resolve — and `respond` gives "Your work": what the Admin
 * assigned the caller, what their teams need picked up, and their own
 * responses. "Assigned to you" shows only while it holds something; the
 * others always keep their place, so the panel does not change shape.
 *
 * Each panel is one frame cut into halves (or thirds) side by side, one
 * per list: a slim header — a dot in the list's colour, its name, what it
 * asks, its count — over rows of the same shape everywhere. Past four rows
 * a list scrolls inside its own height, so a busy day never pushes the
 * rest of the Overview down.
 *
 * The colour is spent on the list's header and its cue, never on the
 * frame: blue for a decision or a pickup, teal for what closes an incident.
 */
export function OperationalAttention() {
  const organization = useOrganization();
  const attention = useIncidentAttention(organization.id);
  const manages = useCan(Permission.INCIDENTS_MANAGE);
  const responds = useCan(Permission.INCIDENTS_RESPOND);

  // Before the answer, the panel the caller's permissions say will come,
  // already framed and about its height, so nothing below it moves when the
  // lists arrive — and a failure is said inside it, under its name.
  if (!attention.data) {
    if (!manages && !responds) return null;

    return (
      <OverviewPanel
        id={manages ? "waiting-on-you" : "your-work"}
        title={manages ? "Waiting on you" : "Your work"}
        description={
          manages
            ? "Incidents that need your decision to move forward."
            : "What you were asked to do, what your teams need picked up, and what you are working on."
        }
      >
        {attention.isError ? (
          <ErrorAlert error={attention.error} />
        ) : (
          <div className="grid min-h-28 place-items-center">
            <Spinner label="Loading what needs you…" />
          </div>
        )}
      </OverviewPanel>
    );
  }

  const { manage, respond } = attention.data;
  // Whoever also manages is shown their own work only when it holds
  // something: an admin on no team would see two lists that never fill.
  const showWork =
    respond !== null &&
    (manage === null ||
      respond.assignedToYou.length +
        respond.needsYourTeam.length +
        respond.yourResponses.length >
        0);

  if (!manage && !showWork) return null;

  // Both of the Admin's lists, each incident once.
  const waiting = manage
    ? new Set([...manage.needsDecision, ...manage.readyToResolve].map(({ id }) => id)).size
    : 0;

  const workGroups: GroupProps[] = respond
    ? [
        ...(respond.assignedToYou.length > 0
          ? [
              {
                id: "assigned-to-you",
                title: "Assigned to you",
                asks: "The Admin asked you to respond",
                tone: "accent" as const,
                incidents: respond.assignedToYou,
                empty: "",
                cue: { label: "Open", variant: "view" as const, icon: UserCheck },
                row: (incident: IncidentDetailResponse) => ({
                  detail: "Nobody has started",
                  since: incident.createdAt,
                }),
              },
            ]
          : []),
        {
          id: "needs-your-team",
          title: "Needs your team",
          asks: "Nobody has started",
          tone: "accent",
          incidents: respond.needsYourTeam,
          empty: "No team incidents need picking up.",
          cue: { label: "Open", variant: "view", icon: ArrowRight },
          row: (incident) => ({
            detail: `${incident.team.name} needs a responder`,
            since: incident.createdAt,
          }),
        },
        {
          id: "your-active-responses",
          title: "Your active responses",
          asks: "You are investigating",
          tone: "accent",
          incidents: respond.yourResponses,
          empty: "You have no active responses.",
          cue: { label: "Open", variant: "view", icon: ArrowRight },
          row: (incident) => {
            const own = incident.responders.find(
              ({ membershipId }) => membershipId === organization.membership.id,
            );

            return { detail: "Started", since: own?.startedAt, ago: true };
          },
        },
      ]
    : [];

  // Stable: a group with work comes before one without.
  workGroups.sort(
    (a, b) =>
      Number(a.incidents.length === 0) - Number(b.incidents.length === 0),
  );

  return (
    // Its children are the panels themselves — no wrapper between. One
    // column at every width: each panel already sets its lists side by side.
    <div className="grid grid-cols-1 gap-6">
      {manage && (
        <OverviewPanel
          id="waiting-on-you"
          title="Waiting on you"
          tone={waiting > 0 ? "action" : "default"}
          // How much is waiting, where the other panels say what period
          // they cover. Nothing waiting is said by the lists themselves.
          label={
            waiting > 0 ? (
              <span
                className={cx(
                  "numeric inline-flex min-w-5 items-center justify-center rounded-full border px-1.5 py-0.5 text-xs font-semibold text-on-accent",
                  // Teal only when all it counts is ready to resolve.
                  manage.needsDecision.length > 0
                    ? "border-accent bg-accent"
                    : "border-status-resolved-text bg-status-resolved-solid",
                )}
              >
                {waiting}
              </span>
            ) : undefined
          }
          description="Incidents that need your decision to move forward."
        >
          <AttentionFrame
            groups={[
              {
                id: "needs-a-decision",
                title: "Needs a decision",
                asks: "Choose who responds",
                tone: "accent",
                incidents: manage.needsDecision,
                empty: "No decisions waiting.",
                cue: { label: "Decide", variant: "primary", icon: Users },
                row: (incident) => ({
                  detail: `${incident.team.name} can see it, but nobody can start yet`,
                  since: incident.createdAt,
                }),
              },
              {
                id: "ready-to-resolve",
                title: "Ready to resolve",
                asks: "Response work complete",
                tone: "resolved",
                incidents: manage.readyToResolve,
                empty: "Nothing is ready to resolve.",
                cue: { label: "Resolve", variant: "complete", icon: Check },
                row: (incident) => {
                  const last = lastFinished(incident);
                  const count = incident.responders.length;

                  return {
                    detail: last
                      ? count > 1
                        ? `${count} responders finished, last ${last.name}`
                        : `${last.name} finished`
                      : "Everyone has finished",
                    since: last?.completedAt ?? undefined,
                    ago: true,
                  };
                },
              },
            ]}
          />
        </OverviewPanel>
      )}
      {showWork && (
        <OverviewPanel
          id="your-work"
          title="Your work"
          // No label: each list already carries its own count.
          description="What you were asked to do, what your teams need picked up, and what you are working on."
        >
          <AttentionFrame groups={workGroups} />
        </OverviewPanel>
      )}
    </div>
  );
}

type Tone = "accent" | "resolved";

/** A list's own colour: its header's dot, wash, name and count. */
const TONES: Record<Tone, { dot: string; wash: string; text: string; count: string }> = {
  accent: {
    dot: "bg-accent-text",
    wash: "bg-[color-mix(in_oklab,var(--color-surface)_91%,var(--color-accent-text))]",
    text: "text-accent-text",
    count:
      "bg-[color-mix(in_oklab,var(--color-surface)_78%,var(--color-accent-text))] text-accent-text",
  },
  resolved: {
    dot: "bg-status-resolved-text",
    wash: "bg-[color-mix(in_oklab,var(--color-surface)_91%,var(--color-status-resolved-text))]",
    text: "text-status-resolved-text",
    count:
      "bg-[color-mix(in_oklab,var(--color-surface)_78%,var(--color-status-resolved-text))] text-status-resolved-text",
  },
};

/** Rows a list shows before it scrolls: four, at `h-16` each. */
const SCROLLS_AFTER = 4;

/** A day, past which a wait reads as late. */
const LATE = 24 * 60 * 60_000;

interface GroupProps {
  id: string;
  title: string;
  /** What the list asks of the caller, beside its name. */
  asks: string;
  tone: Tone;
  incidents: IncidentDetailResponse[];
  empty: string;
  /** The row's visible cue: the link's affordance, not a second control. */
  cue: { label: string; variant: ButtonVariant; icon: ButtonIcon };
  /** Why the incident waits, and since when. */
  row: (incident: IncidentDetailResponse) => {
    detail: string;
    since?: string;
    /** The age is a time ago ("3m ago") rather than a wait ("3m"). */
    ago?: boolean;
  };
}

/**
 * One frame cut into a column per list: stacked on a narrow screen, side
 * by side from `lg` — three from `xl` — divided by a hairline.
 */
function AttentionFrame({ groups }: { groups: GroupProps[] }) {
  return (
    <div
      className={cx(
        "grid grid-cols-1 divide-y divide-line-subtle overflow-hidden rounded-md border border-line-subtle",
        groups.length > 2
          ? "xl:grid-cols-3 xl:divide-x xl:divide-y-0"
          : "lg:grid-cols-2 lg:divide-x lg:divide-y-0",
      )}
    >
      {groups.map((group) => (
        <AttentionGroup key={group.id} {...group} />
      ))}
    </div>
  );
}

/**
 * One list: its slim header, then its rows — or, empty, one quiet line
 * the height of a row, so the halves stay level.
 */
function AttentionGroup({ id, title, asks, tone, incidents, empty, cue, row }: GroupProps) {
  const colours = TONES[tone];
  const scrolls = incidents.length > SCROLLS_AFTER;

  return (
    <div className="flex min-w-0 flex-col">
      <div className={cx("flex min-h-11 items-center gap-2.5 px-4 py-2", colours.wash)}>
        <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", colours.dot)} />
        <h3 id={`${id}-title`} className={cx("shrink-0 text-sm font-semibold", colours.text)}>
          {title}
        </h3>
        <p className="min-w-0 truncate text-xs text-fg-muted">{asks}</p>
        <span
          className={cx(
            "numeric ml-auto inline-flex min-w-6 shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold",
            incidents.length > 0 ? colours.count : "bg-sunken text-fg-subtle",
          )}
        >
          {incidents.length}
        </span>
      </div>
      {incidents.length === 0 ? (
        <p className="flex h-16 items-center gap-2.5 border-t border-line-subtle px-4 text-sm text-fg-muted">
          <CircleCheck aria-hidden="true" className="size-4 text-fg-subtle" />
          {empty}
        </p>
      ) : (
        <ul
          aria-labelledby={`${id}-title`}
          // A list that scrolls can be reached and scrolled from the keyboard.
          tabIndex={scrolls ? 0 : undefined}
          className={cx(
            "scrollbar-thin max-h-64 divide-y divide-line-subtle overflow-y-auto border-t border-line-subtle",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
          )}
        >
          {incidents.map((incident) => (
            <AttentionRow key={incident.id} incident={incident} cue={cue} {...row(incident)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One incident, in a row the same height everywhere: severity, number and
 * title — the link, stretched over the row — above its team and why it
 * waits; then how long, and the cue.
 */
function AttentionRow({
  incident,
  cue,
  detail,
  since,
  ago = false,
}: {
  incident: IncidentDetailResponse;
  cue: GroupProps["cue"];
  detail: string;
  since?: string;
  ago?: boolean;
}) {
  const organization = useOrganization();
  const now = useMinuteClock();
  const late = since !== undefined && now.getTime() - Date.parse(since) > LATE;

  return (
    <li className="group/row relative flex h-16 items-center gap-3 px-4 transition-colors duration-(--duration-fast) hover:bg-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <SeverityMark severity={incident.severity} className="shrink-0 text-xs" />
          <Link
            href={incidentHref(organization.slug, incident.number)}
            className={cx("flex min-w-0 items-baseline gap-2", stretchedLinkClasses)}
          >
            <span className="data shrink-0 text-xs text-fg-subtle">
              {incidentKey(incident.number)}
            </span>{" "}
            <span
              title={incident.title}
              className="truncate text-sm font-medium text-fg underline-offset-2 group-hover/row:underline"
            >
              {incident.title}
            </span>
          </Link>
        </div>
        <p className="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-fg-muted">
          <span className="shrink-0 text-fg">{incident.team.name}</span>
          <span aria-hidden="true" className="text-fg-subtle">
            ·
          </span>
          <span className="truncate">{detail}</span>
        </p>
      </div>
      {since && (
        <span
          className={cx(
            "numeric shrink-0 text-right text-xs",
            late ? "text-warning-text" : "text-fg-muted",
          )}
        >
          {ago ? (
            <>
              <Duration from={since} /> ago
            </>
          ) : (
            <Duration from={since} />
          )}
        </span>
      )}
      <span
        aria-hidden="true"
        className={cx(
          buttonClasses({ variant: cue.variant, size: "sm" }),
          "pointer-events-none hidden shrink-0 sm:inline-flex",
        )}
      >
        <ButtonContent icon={cue.icon}>{cue.label}</ButtonContent>
      </span>
    </li>
  );
}

/** Who finished last, so the row says what changed. */
function lastFinished(incident: IncidentDetailResponse) {
  return incident.responders
    .filter(({ completedAt }) => completedAt !== null)
    .reduce<IncidentDetailResponse["responders"][number] | undefined>(
      (latest, responder) =>
        !latest || responder.completedAt! > latest.completedAt! ? responder : latest,
      undefined,
    );
}
