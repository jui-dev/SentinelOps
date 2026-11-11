"use client";

import { Check, Clock, Link2, Server, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { AnalysisEntry } from "@/components/incident-analyses/analysis-entry";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { criticalityOf } from "@/components/services/criticality";
import { serviceHref } from "@/components/services/service-scope";
import { teamHref, useTeamMembers } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { useMinWidth } from "@/components/ui/use-min-width";
import { rowActionClasses } from "@/components/ui/row-action";
import { PageSpinner } from "@/components/ui/spinner";
import {
  Duration,
  formatDuration,
  LocalDateTime,
  LocalTime,
  useMinuteClock,
} from "@/components/ui/timestamp";
import { linkClasses, quietLinkClasses } from "@/components/ui/link";
import { Permission } from "@/lib/api/contracts";
import type {
  IncidentDetailResponse,
  IncidentResponderResponse,
} from "@/lib/api/contracts";
import { isApiError } from "@/lib/api/errors";

import { PeopleRow, usePeople } from "./incident-people";
import { incidentsHref, useIncident, useIncidentTimeline } from "./incident-queries";
import {
  firstStartOf,
  FollowPanel,
  OversightPanel,
  responseErrorMessage,
  responseStateOf,
  SLOW_START_MS,
  useOwnResponse,
  YourResponse,
} from "./incident-response";
import { RespondersPanel } from "./responders-panel";
import { IncidentTimeline } from "./incident-timeline";
import {
  HappenedBefore,
  KnownIssueMark,
} from "@/components/known-issues/happened-before";
import { LiveStatus } from "./live-status";
import { ManageIncident } from "./manage-incident";
import { incidentKey, SeverityMark, StatusMark } from "./severity";

export const entityLinkClasses = `font-medium text-fg ${quietLinkClasses}`;

/** The incident number in the URL, or undefined when it cannot be one. */
export const parseNumber = (value: string): number | undefined =>
  /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 2_147_483_647
    ? Number(value)
    : undefined;

export function IncidentNotFound({ orgSlug }: { orgSlug: string }) {
  return (
    <PageBody width="form">
      <EmptyState
        className="mt-6"
        headingLevel={1}
        title="Incident not found"
        action={
          <Link
            href={incidentsHref(orgSlug)}
            className={`text-sm ${linkClasses}`}
          >
            All incidents
          </Link>
        }
      >
        <p>There is no incident with this number in this organization.</p>
      </EmptyState>
    </PageBody>
  );
}

/**
 * The caller's part in this incident, from what they may do and the
 * incident's responders:
 *
 *   admin      coordinates and resolves; posts updates; never a responder
 *   responder  has a response — continues and completes it, even if the
 *              incident's team has changed since they started
 *   eligible   on the current responsible team, not yet responding — may
 *              start investigating
 *   observer   anyone else — reads
 *
 * `undefined` while it cannot yet be told whether an observer is eligible:
 * the team's members are still loading. Advice for what to offer; the API
 * decides.
 */
type Perspective = "admin" | "responder" | "eligible" | "observer";

const usePerspective = (
  incident: IncidentDetailResponse,
): { perspective: Perspective | undefined; own?: IncidentResponderResponse } => {
  const organization = useOrganization();
  const canManage = useCan(Permission.INCIDENTS_MANAGE);
  const canRespond = useCan(Permission.RESPONSES_WORK);
  const members = useTeamMembers(organization.id, incident.team.id);
  const own = incident.responders.find(
    ({ membershipId }) => membershipId === organization.membership.id,
  );

  if (canManage) return { perspective: "admin" };
  if (own) return { perspective: "responder", own };
  if (!canRespond || incident.status === "RESOLVED") {
    return { perspective: "observer" };
  }
  // Who the Admin has let start decides who is offered it.
  if (incident.responseAccess === "PENDING") return { perspective: "observer" };
  if (incident.responseAccess === "ASSIGNED") {
    return {
      perspective: incident.assignees.some(
        ({ membershipId }) => membershipId === organization.membership.id,
      )
        ? "eligible"
        : "observer",
    };
  }
  if (members.isError) return { perspective: "observer" };
  if (!members.data) return { perspective: undefined };

  return {
    perspective: members.data.some(
      ({ membershipId }) => membershipId === organization.membership.id,
    )
      ? "eligible"
      : "observer",
  };
};

/** A fact in a header's line: a small label, then its value. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="label-caps text-fg-subtle">{label}</dt>
      <dd className="text-sm text-fg">{children}</dd>
    </div>
  );
}


/** Copies this page's address, and says so for a moment. */
function CopyLink() {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={rowActionClasses("accent")}
      onClick={() => {
        void navigator.clipboard?.writeText(window.location.href).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <Link2 aria-hidden="true" className="size-3.5" />
      )}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/**
 * The incident's header: where it sits (Incidents / INC-42), its key and
 * title, its severity and status, and its summary. Copying its link for
 * everyone; managing it, for the Admin.
 */
function IncidentHeader({
  incident,
  canManage,
  live,
}: {
  incident: IncidentDetailResponse;
  canManage: boolean;
  live: Live;
}) {
  const organization = useOrganization();
  const resolved = incident.status === "RESOLVED";
  const key = incidentKey(incident.number);

  return (
    <PageHeader
      width="reading"
      eyebrow={
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-2">
            <li>
              <Link
                href={incidentsHref(organization.slug)}
                className="rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Incidents
              </Link>
            </li>
            <li aria-hidden="true" className="text-fg-subtle">
              /
            </li>
            <li aria-current="page" className="data text-fg-muted">
              {key}
            </li>
          </ol>
        </nav>
      }
      title={
        <>
          <span className="data font-medium text-fg-subtle">{key}</span>{" "}
          {incident.title}
        </>
      }
      wrapTitle
      description={
        <div className="flex flex-col gap-3 pt-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs">
              <SeverityMark severity={incident.severity} label />
            </span>
            <StatusMark status={incident.status} />
            <KnownIssueMark incident={incident} />
          </div>
          {incident.summary && (
            <p className="text-base whitespace-pre-line text-fg">
              {incident.summary}
            </p>
          )}
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {!resolved && <LiveStatus updatedAt={live.updatedAt} failed={live.failed} />}
          <CopyLink />
          {canManage && !resolved && <ManageIncident incident={incident} />}
        </div>
      }
    />
  );
}

/** One detail card: an icon tile, a label, the value, and one line more. */
function FactCard({
  icon: Icon,
  tone,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  tone: "orange" | "blue" | "teal";
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  // The group holds its term and descriptions directly, as a list's group
  // must; the icon sits in the term, placed beside them by the grid.
  return (
    <div className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 rounded-xl border border-line bg-linear-to-b from-surface to-sunken px-3.5 py-2.5 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:px-4 sm:py-3.5">
      <dt className="contents">
        <span
          aria-hidden="true"
          className={cx(
            "row-span-3 grid size-8 place-items-center rounded-lg border sm:size-10",
            tone === "orange" && "border-warning-line bg-warning-subtle text-warning-text",
            tone === "blue" &&
              "border-status-investigating-line bg-status-investigating-subtle text-status-investigating-text",
            tone === "teal" &&
              "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text",
          )}
        >
          <Icon strokeWidth={2} className="size-4.5" />
        </span>
        <span className="label-caps col-start-2 text-fg-subtle">{label}</span>
      </dt>
      <dd className="col-start-2 truncate text-[0.9375rem] font-semibold text-fg">{value}</dd>
      {note && <dd className="col-start-2 truncate text-xs text-fg-muted">{note}</dd>}
    </div>
  );
}

/**
 * What the incident affects, who is responsible and how many of them are on
 * it, and how long it has been open: three cards, held in a dark section of
 * their own.
 */
function IncidentFacts({ incident }: { incident: IncidentDetailResponse }) {
  const organization = useOrganization();
  const members = useTeamMembers(organization.id, incident.team.id);
  const { investigating, list } = responseStateOf(incident);
  const resolved = incident.status === "RESOLVED";
  const everyoneDone = list.length > 0 && investigating.length === 0;

  const teamNote = resolved
    ? `${list.length} responded`
    : [
        members.data &&
          `${members.data.length} ${members.data.length === 1 ? "member" : "members"}`,
        everyoneDone ? "responders done" : `${investigating.length} on it`,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <dl
      aria-label="Incident details"
      className="grid gap-2 rounded-2xl border border-line-subtle bg-linear-to-b from-rail-top to-rail-mid p-2.5 sm:grid-cols-3 sm:gap-3 sm:p-3.5"
    >
      <FactCard
        icon={Server}
        tone="orange"
        label="Service"
        value={
          <Link
            href={serviceHref(organization.slug, incident.service.slug)}
            className={entityLinkClasses}
          >
            {incident.service.name}
          </Link>
        }
        note={
          <>
            {criticalityOf(incident.service.criticality).label} service
            {incident.service.archivedAt && " · archived"}
          </>
        }
      />
      <FactCard
        icon={Users}
        tone="blue"
        label="Responsible team"
        value={
          <Link
            href={teamHref(organization.slug, incident.team.slug)}
            className={entityLinkClasses}
          >
            {incident.team.name}
          </Link>
        }
        note={
          <span className={cx(everyoneDone && !resolved && "text-status-resolved-text")}>
            {teamNote}
          </span>
        }
      />
      <FactCard
        icon={Clock}
        tone="teal"
        label={resolved ? "Lasted" : "Open for"}
        value={
          <span className="data font-medium">
            <Duration from={incident.createdAt} to={incident.resolvedAt} />
          </span>
        }
        note={
          <>
            since <LocalDateTime value={incident.createdAt} />
          </>
        }
      />
    </dl>
  );
}

type StepState = "done" | "current" | "todo";

/** A step's round marker: a tick when done, a ring when now, empty after. */
function StepMark({ state, tone }: { state: StepState; tone: "blue" | "teal" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid size-7 shrink-0 place-items-center rounded-full border-2",
        state === "done" &&
          "border-status-resolved-text bg-status-resolved-subtle text-status-resolved-text",
        state === "current" &&
          (tone === "blue"
            ? "border-status-investigating-text bg-status-investigating-subtle shadow-[0_0_0_5px_var(--color-status-investigating-subtle)]"
            : "border-status-resolved-text bg-status-resolved-subtle shadow-[0_0_0_5px_var(--color-status-resolved-subtle)]"),
        state === "todo" && "border-line-strong",
      )}
    >
      {state === "done" && <Check strokeWidth={3} className="size-3.5" />}
      {state === "current" && (
        <span
          className={cx(
            "size-2 rounded-full",
            tone === "blue" ? "bg-status-investigating-text" : "bg-status-resolved-text",
          )}
        />
      )}
    </span>
  );
}

/** One step: its mark and the link to the next, then its name and when. */
function Step({
  label,
  state,
  tone = "blue",
  link,
  children,
}: {
  label: string;
  state: StepState;
  tone?: "blue" | "teal";
  /** The line to the next step, and what it says; none for the last. */
  link?: ReactNode;
  children: ReactNode;
}) {
  return (
    // A phone reads the steps down the page, each mark beside its words.
    <li
      aria-current={state === "current" ? "step" : undefined}
      className="flex min-w-0 items-start gap-3 sm:flex-col sm:gap-2.5"
    >
      <span className="flex shrink-0 items-center gap-2 sm:w-full">
        <StepMark state={state} tone={tone} />
        {link}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 pt-0.5 pr-3 sm:pt-0">
        <span
          className={cx(
            "text-sm font-semibold",
            state === "current" &&
              (tone === "blue" ? "text-status-investigating-text" : "text-status-resolved-text"),
            state === "todo" && "text-fg-muted",
            state === "done" && "text-fg",
          )}
        >
          {label}
          <span className="sr-only">
            {state === "done" ? " (done)" : state === "current" ? " (now)" : " (next)"}
          </span>
        </span>
        <span className="text-xs text-fg-subtle">{children}</span>
      </span>
    </li>
  );
}

/** A solid line between two steps, with a figure on it if it has one. */
function StepLink({
  done,
  chip,
  warn = false,
}: {
  done: boolean;
  chip?: ReactNode;
  warn?: boolean;
}) {
  const line = (
    <span
      aria-hidden="true"
      className={cx(
        "h-0.5 min-w-3 flex-1 rounded-full",
        !done && "h-0 border-t-2 border-dashed border-line-strong",
        done && (warn ? "bg-warning-text" : "bg-status-resolved-text"),
      )}
    />
  );

  return (
    <span className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
      {line}
      {chip && (
        <>
          <span
            className={cx(
              "data shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem]",
              warn
                ? "border-warning-line bg-warning-subtle text-warning-text"
                : "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text",
            )}
          >
            {chip}
          </span>
          {line}
        </>
      )}
    </span>
  );
}

/**
 * Where the incident is in its only path — Declared, then Investigating,
 * then Resolved — with when each step was reached and what the next waits
 * for. The link out of Declared says how long it waited for someone to
 * start: amber when that was slow, or while it still waits. Once everyone
 * who started has completed, the last step is "Ready to resolve".
 */
function Lifecycle({ incident }: { incident: IncidentDetailResponse }) {
  const now = useMinuteClock();
  const firstStart = firstStartOf(incident);
  const { state, investigating, list } = responseStateOf(incident);
  const resolved = state === "resolved";
  const ready = state === "complete";
  const wait = (firstStart ? Date.parse(firstStart) : now.getTime()) - Date.parse(incident.createdAt);
  const slow = !firstStart || wait > SLOW_START_MS;
  const waited = firstStart
    ? `${formatDuration(wait)} to start`
    : resolved
      ? undefined
      : `waiting ${formatDuration(wait)}`;

  // Once resolved, the path is done: one quiet line of ticks says it, with
  // the wait to start on it, and the Resolution beneath says the rest.
  if (resolved) {
    const done = "inline-flex items-center gap-1.5 text-status-resolved-text";
    const rule = (
      <span aria-hidden="true" className="h-0.5 min-w-4 flex-1 rounded-full bg-status-resolved-line" />
    );

    // Each step holds the line to the next, so the list holds only steps.
    return (
      <ol
        aria-label="Lifecycle"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-surface px-4.5 py-3 text-sm sm:flex-nowrap"
      >
        <li className="flex min-w-0 flex-1 items-center gap-3">
          <span className={done}>
            <Check aria-hidden="true" strokeWidth={3} className="size-3.5" />
            Declared
          </span>
          {rule}
          {waited && (
            <>
              <span
                className={cx(
                  "data shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem]",
                  slow
                    ? "border-warning-line bg-warning-subtle text-warning-text"
                    : "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text",
                )}
              >
                {waited}
              </span>
              {rule}
            </>
          )}
        </li>
        <li className="flex min-w-0 flex-1 items-center gap-3">
          <span className={firstStart ? done : "text-fg-muted"}>
            {firstStart && <Check aria-hidden="true" strokeWidth={3} className="size-3.5" />}
            {firstStart ? "Investigated" : "No one responded"}
          </span>
          {rule}
        </li>
        <li className={done}>
          <Check aria-hidden="true" strokeWidth={3} className="size-3.5" />
          Resolved{" "}
          {incident.resolvedAt && (
            <span className="data">
              <LocalTime value={incident.resolvedAt} />
            </span>
          )}
        </li>
      </ol>
    );
  }

  return (
    <ol
      aria-label="Lifecycle"
      className="grid gap-3.5 rounded-2xl border border-line bg-surface px-4 py-4 sm:grid-cols-3 sm:gap-0 sm:px-5 sm:py-4.5"
    >
      <Step
        label="Declared"
        state="done"
        link={<StepLink done={!!firstStart || !resolved} warn={slow} chip={waited} />}
      >
        <LocalDateTime value={incident.createdAt} /> · {incident.createdBy.name}
        {/* A phone has no line between the steps to carry the wait: said here. */}
        {waited && (
          <span
            className={cx(
              "data mt-1 block w-max rounded-full border px-2 py-0.5 text-[0.6875rem] sm:hidden",
              slow
                ? "border-warning-line bg-warning-subtle text-warning-text"
                : "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text",
            )}
          >
            {waited}
          </span>
        )}
      </Step>
      <Step
        label={ready || resolved ? "Investigated" : "Investigating"}
        state={incident.status === "DECLARED" ? "todo" : ready || resolved ? "done" : "current"}
        link={<StepLink done={ready || resolved} />}
      >
        {firstStart ? (
          ready || resolved ? (
            `${list.length} ${list.length === 1 ? "responder" : "responders"}${ready ? " · all done" : ""}`
          ) : (
            <>
              since <LocalDateTime value={firstStart} /> · {investigating.length} on it
            </>
          )
        ) : resolved ? (
          "No one responded"
        ) : (
          `when someone on ${incident.team.name} starts`
        )}
      </Step>
      <Step
        label={ready ? "Ready to resolve" : "Resolved"}
        state={resolved ? "done" : ready ? "current" : "todo"}
        tone="teal"
      >
        {incident.resolvedAt ? (
          <LocalDateTime value={incident.resolvedAt} />
        ) : ready ? (
          "the Admin resolves next"
        ) : (
          "by the Admin, once no one is still investigating"
        )}
      </Step>
    </ol>
  );
}


/**
 * How a resolved incident ended, said once: the Admin's note — or, resolved
 * before notes were required, that there is none — who resolved it and
 * when, the four figures the response is read by, and who responded. Where
 * the role panels stood while it was open: once resolved there is nothing
 * left to do on it but learn from it, which the analysis beneath is for.
 */
function Resolution({ incident }: { incident: IncidentDetailResponse }) {
  const organization = useOrganization();
  const headingId = useId();
  const timeline = useIncidentTimeline(organization.id, incident.number);
  const people = usePeople(incident);
  const firstStart = firstStartOf(incident);
  const resolvedBy = timeline.data?.findLast(
    ({ type, toValue }) => type === "STATUS_CHANGED" && toValue === "RESOLVED",
  )?.actor.name;
  const updates = timeline.data?.filter(({ type }) => type === "UPDATE").length;

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-2xl border border-status-resolved-line bg-linear-to-b from-status-resolved-subtle to-surface"
    >
      <div className="grid gap-5 px-5 py-5 sm:px-6 md:grid-cols-[minmax(0,1fr)_17rem] md:gap-7">
        <div className="flex min-w-0 flex-col gap-2.5">
          <h2 id={headingId} className="label-caps text-status-resolved-text">
            Resolution
          </h2>
          {incident.resolution ? (
            <p className="text-[0.9375rem] leading-relaxed whitespace-pre-line text-fg">
              {incident.resolution}
            </p>
          ) : (
            <p className="text-sm text-fg-muted">
              Resolved before resolution notes were recorded.
            </p>
          )}
          <p className="text-xs text-fg-muted">
            Resolved {incident.resolvedAt && <LocalDateTime value={incident.resolvedAt} />}
            {resolvedBy && ` by ${resolvedBy}`} · kept as it is; if it returns,
            declare a new incident.
          </p>
        </div>
        <dl
          aria-label={`${incidentKey(incident.number)} at a glance`}
          className="grid grid-cols-2 gap-x-5 gap-y-3.5 self-start rounded-xl border border-status-resolved-line/70 bg-canvas/40 px-4.5 py-4"
        >
          {[
            [
              "Lasted",
              <Duration key="lasted" from={incident.createdAt} to={incident.resolvedAt} />,
            ],
            [
              "First response",
              firstStart
                ? formatDuration(Date.parse(firstStart) - Date.parse(incident.createdAt))
                : "—",
            ],
            ["Responders", incident.responders.length],
            ["Updates", updates ?? "—"],
          ].map(([label, value]) => (
            <div key={label as string} className="flex flex-col gap-0.5">
              <dt className="label-caps text-fg-subtle">{label}</dt>
              <dd className="numeric text-lg font-semibold text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {people.length > 0 && (
        <div className="border-t border-status-resolved-line/60 bg-canvas/20 px-5 py-3.5 sm:px-6">
          <PeopleRow label={incident.team.name} people={people} />
        </div>
      )}
    </section>
  );
}

/** How fresh the incident on the page is, from its own query. */
type Live = { updatedAt: number; failed: boolean };


/**
 * The incident, read top to bottom in one column: its header, the facts in
 * their dark section, where it is in its lifecycle, how it ended once it
 * has, then the caller's panel — a member's own response, oversight's
 * response and resolution, or a reader's view of who is on it — and the
 * timeline beneath, in a dark panel of its own.
 */
function IncidentPage({
  incident,
  live,
}: {
  incident: IncidentDetailResponse;
  live: Live;
}) {
  const { perspective, own } = usePerspective(incident);
  const actions = useOwnResponse(incident);
  const oversees = useCan(Permission.INCIDENTS_READ_ALL);
  const resolved = incident.status === "RESOLVED";
  const canManage = perspective === "admin";
  const working =
    perspective === "eligible" || (perspective === "responder" && !!own);
  const actionError = actions.start.error ?? actions.complete.error;
  // On a phone, a member investigating posts from a bar pinned to the foot
  // of the screen; the page leaves room beneath for it.
  const wide = useMinWidth();
  const pinned =
    !wide && working && own?.status === "INVESTIGATING" && !resolved;

  return (
    <>
      <IncidentHeader incident={incident} canManage={canManage} live={live} />
      <PageBody width="reading" className={cx(pinned && "pb-48")}>
        <div className="flex flex-col gap-6">
          <IncidentFacts incident={incident} />
          <Lifecycle incident={incident} />
          {actionError && (
            <ErrorAlert
              error={actionError}
              message={responseErrorMessage(actionError)}
            />
          )}
          {resolved ? (
            // How it ended, said once, then what to learn from it: the
            // Admin's next step. No role panel: nothing is left to do on it.
            <>
              <Resolution incident={incident} />
              <AnalysisEntry incident={incident} />
            </>
          ) : canManage || (oversees && !working) ? (
            <>
              {canManage && <RespondersPanel incident={incident} />}
              <OversightPanel incident={incident} canManage={canManage} />
            </>
          ) : working ? (
            <YourResponse incident={incident} own={own} actions={actions} pinned={pinned} />
          ) : (
            <FollowPanel incident={incident} />
          )}
          <HappenedBefore incident={incident} />
          <IncidentTimeline
            incident={incident}
            tone={canManage || oversees ? "oversight" : "member"}
            // Working it, the updates are the point; once resolved, the whole story.
            preferUpdates={working && !resolved}
          />
        </div>
      </PageBody>
    </>
  );
}


/**
 * One incident, at `/incidents/[incidentNumber]`: what it is and what it
 * affects, where it is in its lifecycle, where the response stands, and its
 * timeline. What the page offers follows the caller's part in it: the Admin
 * coordinates and resolves; a member of the responsible team starts
 * investigating, posts updates, and completes their response; anyone else
 * follows it. The one place each of those is done.
 */
export function IncidentDetail() {
  const organization = useOrganization();
  const { orgSlug, incidentNumber } = useParams<{
    orgSlug: string;
    incidentNumber: string;
  }>();
  const number = parseNumber(incidentNumber);

  if (number === undefined) return <IncidentNotFound orgSlug={orgSlug} />;

  return (
    <LoadedIncident
      organizationId={organization.id}
      number={number}
      orgSlug={orgSlug}
    />
  );
}

function LoadedIncident({
  organizationId,
  number,
  orgSlug,
}: {
  organizationId: string;
  number: number;
  orgSlug: string;
}) {
  const incident = useIncident(organizationId, number, { live: true });

  if (isApiError(incident.error, 404)) {
    return <IncidentNotFound orgSlug={orgSlug} />;
  }

  // A refresh that failed keeps the incident on the page, marked stale.
  if (incident.isError && !incident.data) {
    return (
      <PageBody width="form">
        <ErrorAlert error={incident.error} />
      </PageBody>
    );
  }

  if (!incident.data) return <PageSpinner />;

  return (
    <IncidentPage
      incident={incident.data}
      live={{
        updatedAt: incident.dataUpdatedAt,
        failed: incident.isRefetchError,
      }}
    />
  );
}
