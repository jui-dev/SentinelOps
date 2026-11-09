"use client";

import { Check, CircleCheck, Clock, Link2, MessageSquare, Users, Zap } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { AnalysisEntry } from "@/components/incident-analyses/analysis-entry";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { CriticalityMark } from "@/components/services/criticality-mark";
import { serviceHref } from "@/components/services/service-scope";
import { teamHref, useTeamMembers } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { DetailCard, Glance, GlanceTile } from "@/components/ui/detail-layout";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { rowActionClasses } from "@/components/ui/row-action";
import { PageSpinner } from "@/components/ui/spinner";
import {
  Duration,
  formatDuration,
  LocalDateTime,
  useMinuteClock,
} from "@/components/ui/timestamp";
import { linkClasses, quietLinkClasses } from "@/components/ui/link";
import { Permission } from "@/lib/api/contracts";
import type {
  IncidentDetailResponse,
  IncidentResponderResponse,
} from "@/lib/api/contracts";
import { isApiError } from "@/lib/api/errors";

import { incidentsHref, useIncident, useIncidentTimeline } from "./incident-queries";
import {
  Avatar,
  ResponseCard,
  responseErrorMessage,
  responseStateOf,
  useOwnResponse,
  YourResponse,
} from "./incident-response";
import { IncidentTimeline } from "./incident-timeline";
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
  const canRespond = useCan(Permission.INCIDENTS_RESPOND);
  const members = useTeamMembers(organization.id, incident.team.id);
  const own = incident.responders.find(
    ({ membershipId }) => membershipId === organization.membership.id,
  );

  if (canManage) return { perspective: "admin" };
  if (own) return { perspective: "responder", own };
  if (!canRespond || incident.status === "RESOLVED") {
    return { perspective: "observer" };
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

/** When the first responder started: the moment investigation began. */
const firstStartOf = (incident: IncidentDetailResponse) =>
  incident.responders.reduce<string | undefined>(
    (first, { startedAt }) =>
      first === undefined || Date.parse(startedAt) < Date.parse(first)
        ? startedAt
        : first,
    undefined,
  );

/** A service or team named in the header: a quiet chip, not a link. */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-hover px-2.5 py-px text-sm text-fg">
      {children}
    </span>
  );
}

/**
 * The incident's header: where it sits (Incidents / INC-42), its severity,
 * status, and how long it has been open, its key and title, what it affects
 * and who is responsible, and its summary. Managing it, for the Admin.
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
      width="full"
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
            <span className="inline-flex items-center rounded-sm border border-line bg-surface px-2 py-0.5 text-xs">
              <SeverityMark severity={incident.severity} label />
            </span>
            <StatusMark status={incident.status} />
            <span className="data text-sm text-fg-muted">
              {resolved ? "Lasted " : "Open for "}
              <Duration from={incident.createdAt} to={incident.resolvedAt} />
            </span>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span>Affects</span>
            <Chip>
              {incident.service.name}
              {incident.service.archivedAt && (
                <span className="text-fg-muted"> (archived)</span>
              )}
            </Chip>
            <span aria-hidden="true">·</span>
            <span>Responsible</span>
            <Chip>{incident.team.name}</Chip>
          </p>
          {incident.summary && (
            <p className="text-base whitespace-pre-line text-fg">
              {incident.summary}
            </p>
          )}
        </div>
      }
      actions={
        !resolved && (
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <LiveStatus updatedAt={live.updatedAt} failed={live.failed} />
            {canManage && <ManageIncident incident={incident} />}
          </div>
        )
      }
    />
  );
}

type StepState = "done" | "current" | "todo";

/** One step of the lifecycle: its mark, its name, and when. */
function Step({
  label,
  state,
  last = false,
  children,
}: {
  label: string;
  state: StepState;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      aria-current={state === "current" ? "step" : undefined}
      className="flex min-w-0 items-center gap-2.5"
    >
      <span
        aria-hidden="true"
        className={cx(
          "grid size-6 shrink-0 place-items-center rounded-full border",
          state === "done" &&
            "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text",
          state === "current" &&
            "border-2 border-status-investigating-text bg-status-investigating-subtle",
          state === "todo" && "border-line-strong bg-surface",
        )}
      >
        {state === "done" && <Check strokeWidth={3} className="size-3.5" />}
        {state === "current" && (
          <span className="size-2 rounded-full bg-status-investigating-text" />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cx(
            "text-sm font-semibold",
            state === "current" && "text-status-investigating-text",
            state === "todo" && "text-fg-muted",
            state === "done" && "text-fg",
          )}
        >
          {label}
          <span className="sr-only">
            {state === "done" ? " (done)" : state === "current" ? " (now)" : " (next)"}
          </span>
        </span>
        <span className="truncate text-xs text-fg-subtle">{children}</span>
      </span>
      {!last && (
        <span
          aria-hidden="true"
          className={cx(
            "mx-3 hidden h-0.5 min-w-6 flex-1 rounded-full sm:block",
            state === "done" ? "bg-status-resolved-line" : "bg-line",
          )}
        />
      )}
    </li>
  );
}

/**
 * Where the incident is in its only path — Declared, then Investigating,
 * then Resolved — with when each step was reached, and what the next waits
 * for.
 */
function Lifecycle({ incident }: { incident: IncidentDetailResponse }) {
  const firstStart = firstStartOf(incident);
  const { investigating } = responseStateOf(incident);
  const order = ["DECLARED", "INVESTIGATING", "RESOLVED"] as const;
  const at = order.indexOf(incident.status);
  const stateOf = (index: number): StepState =>
    incident.status === "RESOLVED" || index < at
      ? "done"
      : index === at
        ? "current"
        : "todo";

  return (
    <ol
      aria-label="Lifecycle"
      className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 sm:grid-cols-3 sm:gap-0 sm:px-5"
    >
      <Step label="Declared" state={stateOf(0)}>
        <LocalDateTime value={incident.createdAt} /> · {incident.createdBy.name}
      </Step>
      <Step label="Investigating" state={stateOf(1)}>
        {firstStart ? (
          <>
            since <LocalDateTime value={firstStart} />
            {incident.status === "INVESTIGATING" &&
              ` · ${investigating.length} on it now`}
          </>
        ) : (
          `when someone on ${incident.team.name} starts`
        )}
      </Step>
      <Step label="Resolved" state={stateOf(2)} last>
        {incident.resolvedAt ? (
          <LocalDateTime value={incident.resolvedAt} />
        ) : (
          "once no one is still investigating"
        )}
      </Step>
    </ol>
  );
}

/**
 * The incident in four figures, none of which the header already says: how
 * long it has been open, how soon someone responded, how many are
 * responding, and how many updates they have posted. About the incident,
 * never a measure of a person.
 */
function IncidentGlance({ incident }: { incident: IncidentDetailResponse }) {
  const organization = useOrganization();
  const timeline = useIncidentTimeline(organization.id, incident.number);
  const now = useMinuteClock();
  const firstStart = firstStartOf(incident);
  const { list, investigating, complete } = responseStateOf(incident);
  const resolved = incident.status === "RESOLVED";
  const updates = (timeline.data ?? []).filter(({ type }) => type === "UPDATE");
  const lastUpdate = updates.at(-1);
  const firstResponder = incident.responders.find(
    ({ startedAt }) => startedAt === firstStart,
  );

  return (
    <Glance label={`${incidentKey(incident.number)} at a glance`} columns={4}>
      <GlanceTile
        label={resolved ? "Lasted" : "Open for"}
        icon={Clock}
        tone="accent"
        value={<Duration from={incident.createdAt} to={incident.resolvedAt} />}
      />
      <GlanceTile
        label="First response"
        icon={Zap}
        tone={firstStart ? "resolved" : "warning"}
        noteTone={!firstStart}
        value={
          firstStart
            ? formatDuration(Date.parse(firstStart) - Date.parse(incident.createdAt))
            : "—"
        }
        note={firstResponder ? `by ${firstResponder.name}` : "no one yet"}
      />
      <GlanceTile
        label="Responders"
        icon={Users}
        tone="investigating"
        value={list.length}
        note={
          list.length === 0
            ? "no one yet"
            : `${investigating.length} investigating · ${complete} complete`
        }
      />
      <GlanceTile
        label="Updates"
        icon={MessageSquare}
        tone="info"
        value={timeline.data ? updates.length : "—"}
        note={
          lastUpdate
            ? `last ${formatDuration(now.getTime() - Date.parse(lastUpdate.createdAt))} ago`
            : timeline.data
              ? "none yet"
              : undefined
        }
      />
    </Glance>
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

/** The record: what it affects, who is responsible, and when. */
function Details({ incident }: { incident: IncidentDetailResponse }) {
  const organization = useOrganization();
  const now = useMinuteClock();

  return (
    <DetailCard id="details" title="Details" action={<CopyLink />}>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 px-4 py-3.5 text-sm sm:px-5">
        <dt className="text-fg-subtle">Service</dt>
        <dd className="flex flex-wrap items-center gap-x-2">
          <Link
            href={serviceHref(organization.slug, incident.service.slug)}
            className={entityLinkClasses}
          >
            {incident.service.name}
          </Link>
          {incident.service.archivedAt && (
            <span className="text-fg-muted">(archived)</span>
          )}
          <span className="text-fg-muted">
            <CriticalityMark criticality={incident.service.criticality} />
          </span>
        </dd>
        <dt className="text-fg-subtle">Responsible</dt>
        <dd>
          <Link
            href={teamHref(organization.slug, incident.team.slug)}
            className={entityLinkClasses}
          >
            {incident.team.name}
          </Link>
        </dd>
        <dt className="text-fg-subtle">Declared</dt>
        <dd>
          <LocalDateTime value={incident.createdAt} />
          <span className="mt-0.5 block text-fg-muted">
            by {incident.createdBy.name}
          </span>
        </dd>
        {incident.resolvedAt && (
          <>
            <dt className="text-fg-subtle">Resolved</dt>
            <dd>
              <LocalDateTime value={incident.resolvedAt} />
            </dd>
          </>
        )}
        <dt className="text-fg-subtle">Last changed</dt>
        <dd>
          <time dateTime={incident.updatedAt}>
            {formatDuration(now.getTime() - Date.parse(incident.updatedAt))} ago
          </time>
        </dd>
      </dl>
    </DetailCard>
  );
}

type Person = {
  membershipId: string;
  name: string;
  state: "investigating" | "complete" | "not-joined";
};

const PERSON_STATES: Record<Person["state"], { word: string; colour: string }> = {
  investigating: { word: "investigating", colour: "text-status-investigating-text" },
  complete: { word: "done", colour: "text-status-resolved-text" },
  "not-joined": { word: "not joined", colour: "text-fg-subtle" },
};

/**
 * Everyone who can respond, and where each stands: whoever is investigating,
 * whoever is done, then the rest of the responsible team, who have not
 * joined. Someone who started before a reassignment stays, though no
 * longer on the team. Once resolved, only those who responded. When the
 * caller cannot see the team's members, only the responders.
 */
function WhoCanRespond({ incident }: { incident: IncidentDetailResponse }) {
  const organization = useOrganization();
  const members = useTeamMembers(organization.id, incident.team.id);
  const resolved = incident.status === "RESOLVED";
  const responding = new Set(incident.responders.map(({ membershipId }) => membershipId));

  const people: Person[] = [
    ...incident.responders
      .filter(({ status }) => status === "INVESTIGATING")
      .map(({ membershipId, name }) => ({ membershipId, name, state: "investigating" as const })),
    ...incident.responders
      .filter(({ status }) => status === "COMPLETED")
      .map(({ membershipId, name }) => ({ membershipId, name, state: "complete" as const })),
    ...(resolved
      ? []
      : (members.data ?? [])
          .filter(({ membershipId }) => !responding.has(membershipId))
          .map(({ membershipId, user }) => ({
            membershipId,
            name: user.name,
            state: "not-joined" as const,
          }))),
  ];

  const footer = resolved
    ? undefined
    : members.data
      ? `Everyone on ${incident.team.name}, the responsible team.`
      : `Members of ${incident.team.name}, the responsible team, can respond.`;

  return (
    <DetailCard
      id="who-can-respond"
      title={resolved ? "Who responded" : "Who can respond"}
      meta={people.length}
      footer={footer}
    >
      {people.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-muted sm:px-5">
          {resolved ? "No one responded." : "No one on the team yet."}
        </p>
      ) : (
        <ul aria-label="People" className="divide-y divide-line-subtle">
          {people.map((person) => {
            const { word, colour } = PERSON_STATES[person.state];

            return (
              <li
                key={person.membershipId}
                className="flex items-center gap-2.5 px-4 py-2 sm:px-5"
              >
                <Avatar
                  name={person.name}
                  size="sm"
                  tone={
                    person.state === "not-joined"
                      ? "quiet"
                      : person.state === "complete"
                        ? "complete"
                        : "investigating"
                  }
                />
                <span
                  className={cx(
                    "min-w-0 flex-1 truncate text-sm",
                    person.state === "not-joined" ? "text-fg-muted" : "text-fg",
                  )}
                >
                  {person.name}
                </span>
                <span className={cx("text-xs", colour)}>{word}</span>
              </li>
            );
          })}
        </ul>
      )}
    </DetailCard>
  );
}

/**
 * How a resolved incident ended: the Admin's note, framed with the success
 * edge completed work has. An incident resolved before notes were required
 * says so, rather than leaving a gap.
 */
function Resolution({
  resolution,
  resolvedAt,
}: {
  resolution: string | null;
  resolvedAt: string;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex gap-3 rounded-lg border border-status-resolved-line border-l-[3px] border-l-status-resolved-text bg-status-resolved-subtle px-4 py-4 sm:px-5"
    >
      <CircleCheck
        aria-hidden="true"
        strokeWidth={2}
        className="mt-1 size-4 shrink-0 text-status-resolved-text"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 id={headingId} className="text-base font-semibold text-fg">
          Resolution
        </h2>
        {resolution ? (
          <p className="max-w-3xl text-sm leading-6 whitespace-pre-line text-fg">
            {resolution}
          </p>
        ) : (
          <p className="text-sm text-fg-muted">
            Resolved before resolution notes were recorded.
          </p>
        )}
        <p className="text-xs text-fg-muted">
          Resolved <LocalDateTime value={resolvedAt} />. A resolved incident is
          kept as it is; if the problem returns, declare a new incident.
        </p>
      </div>
    </section>
  );
}

/** How fresh the incident on the page is, from its own query. */
type Live = { updatedAt: number; failed: boolean };

function IncidentPage({
  incident,
  live,
}: {
  incident: IncidentDetailResponse;
  live: Live;
}) {
  const { perspective, own } = usePerspective(incident);
  const actions = useOwnResponse(incident);
  const resolved = incident.status === "RESOLVED";
  const canManage = perspective === "admin";
  const working =
    perspective === "eligible" || (perspective === "responder" && !!own);
  const canPost =
    !resolved && (canManage || own?.status === "INVESTIGATING");
  const actionError = actions.start.error ?? actions.complete.error;

  return (
    <>
      <IncidentHeader incident={incident} canManage={canManage} live={live} />
      <PageBody width="full">
        <div className="flex flex-col gap-6">
          <Lifecycle incident={incident} />
          {/* How it ended, then what was learned from it: one closing pair. */}
          {resolved && incident.resolvedAt && (
            <div className="flex flex-col gap-3">
              <Resolution
                resolution={incident.resolution}
                resolvedAt={incident.resolvedAt}
              />
              <AnalysisEntry incident={incident} />
            </div>
          )}
          <IncidentGlance incident={incident} />
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,23rem)]">
            <div className="flex min-w-0 flex-col gap-6">
              {actionError && (
                <ErrorAlert
                  error={actionError}
                  message={responseErrorMessage(actionError)}
                />
              )}
              {/* A member's own part first; the team's response for everyone. */}
              {working && (
                <YourResponse incident={incident} own={own} actions={actions} />
              )}
              <ResponseCard incident={incident} canManage={canManage} />
              <IncidentTimeline incident={incident} canPost={canPost} />
            </div>
            <aside
              aria-label="Incident details"
              className="flex flex-col gap-6 lg:sticky lg:top-6"
            >
              <Details incident={incident} />
              <WhoCanRespond incident={incident} />
            </aside>
          </div>
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
