"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useId } from "react";
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
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { RecordList, RecordRow } from "@/components/ui/record";
import { PageSpinner } from "@/components/ui/spinner";
import { Duration, IsoDate, LocalDateTime } from "@/components/ui/timestamp";
import { linkClasses, quietLinkClasses } from "@/components/ui/link";
import { Permission } from "@/lib/api/contracts";
import type {
  IncidentDetailResponse,
  IncidentResponderResponse,
} from "@/lib/api/contracts";
import { isApiError } from "@/lib/api/errors";

import { incidentsHref, useIncident } from "./incident-queries";
import {
  ResponsePanel,
  responseErrorMessage,
  TeamResponse,
  useOwnResponse,
  YourResponse,
} from "./incident-response";
import { IncidentTimeline } from "./incident-timeline";
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

/** A fact in the header's line: a small label, then its value. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="label-caps text-fg-subtle">{label}</dt>
      <dd className="text-sm text-fg">{children}</dd>
    </div>
  );
}

/**
 * The incident at a glance: its number and how long it has been open, its
 * title, one line of facts — severity, status, affected service, responsible
 * team — and its summary as the lead. Links, not cards.
 */
function IncidentHeader({
  incident,
  canManage,
}: {
  incident: IncidentDetailResponse;
  canManage: boolean;
}) {
  const organization = useOrganization();
  const resolved = incident.status === "RESOLVED";

  return (
    <PageHeader
      eyebrow={
        <>
          <span className="data">{incidentKey(incident.number)}</span>
          <span aria-hidden="true"> · </span>
          <span>
            {resolved ? "Lasted " : "Open for "}
            <span className="data">
              <Duration from={incident.createdAt} to={incident.resolvedAt} />
            </span>
          </span>
        </>
      }
      title={incident.title}
      wrapTitle
      description={
        <div className="flex flex-col gap-3 pt-1">
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <dt className="sr-only">Severity</dt>
              <dd className="text-sm">
                <SeverityMark severity={incident.severity} label />
              </dd>
            </div>
            <div>
              <dt className="sr-only">Status</dt>
              <dd className="text-sm">
                <StatusMark status={incident.status} />
              </dd>
            </div>
            <Fact label="Service">
              <Link
                href={serviceHref(organization.slug, incident.service.slug)}
                className={entityLinkClasses}
              >
                {incident.service.name}
              </Link>
              {incident.service.archivedAt && (
                <span className="text-fg-muted"> (archived)</span>
              )}
              <span className="ml-2 text-fg-muted">
                <CriticalityMark criticality={incident.service.criticality} />
              </span>
            </Fact>
            <Fact label="Team">
              <Link
                href={teamHref(organization.slug, incident.team.id)}
                className={entityLinkClasses}
              >
                {incident.team.name}
              </Link>
            </Fact>
          </dl>
          {incident.summary && (
            <p className="text-base whitespace-pre-line text-fg">
              {incident.summary}
            </p>
          )}
        </div>
      }
      actions={canManage && !resolved && <ManageIncident incident={incident} />}
    />
  );
}

/**
 * How a resolved incident ended: the Admin's note, framed with the success
 * edge the response panel gives completed work — resolution is the same
 * milestone, reached. An incident resolved before notes were required says
 * so, rather than leaving a gap.
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
      className="flex gap-3 rounded-md border border-status-resolved-line border-l-[3px] border-l-status-resolved-text bg-status-resolved-subtle px-4 py-4 sm:px-5"
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

function IncidentPage({ incident }: { incident: IncidentDetailResponse }) {
  const { perspective, own } = usePerspective(incident);
  const actions = useOwnResponse(incident);
  const resolved = incident.status === "RESOLVED";
  const canManage = perspective === "admin";
  const working =
    perspective === "eligible" || (perspective === "responder" && !!own);
  const actionError = actions.start.error ?? actions.complete.error;

  return (
    <>
      <IncidentHeader incident={incident} canManage={canManage} />
      <PageBody>
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
        <div className="grid items-start gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-w-0 flex-col gap-8">
            {actionError && (
              <ErrorAlert
                error={actionError}
                message={responseErrorMessage(actionError)}
              />
            )}
            {/* A member's own work first, the team's beneath it; everyone
                else sees the team's response as the page's centre. */}
            {working ? (
              <>
                <YourResponse incident={incident} own={own} actions={actions} />
                <TeamResponse incident={incident} />
              </>
            ) : (
              <ResponsePanel incident={incident} canManage={canManage} />
            )}
            <IncidentTimeline incident={incident} canPost={canManage && !resolved} />
          </div>
          <aside aria-label="Incident details">
            <RecordList stacked>
              <RecordRow label="Declared">
                <LocalDateTime value={incident.createdAt} />
                <span className="mt-0.5 block text-sm text-fg-muted">
                  by {incident.createdBy.name}
                </span>
              </RecordRow>
              {incident.resolvedAt && (
                <RecordRow label="Resolved">
                  <LocalDateTime value={incident.resolvedAt} />
                </RecordRow>
              )}
              <RecordRow label="Last changed">
                <IsoDate value={incident.updatedAt} />
              </RecordRow>
            </RecordList>
          </aside>
        </div>
      </PageBody>
    </>
  );
}

/**
 * One incident, at `/incidents/[incidentNumber]`: what it is and what it
 * affects, where the response stands, and its timeline. What the page offers
 * follows the caller's part in it: the Admin coordinates and resolves; a
 * member of the responsible team starts investigating, posts updates, and
 * completes their response; anyone else follows it.
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
  const incident = useIncident(organizationId, number);

  if (isApiError(incident.error, 404)) {
    return <IncidentNotFound orgSlug={orgSlug} />;
  }

  if (incident.isError) {
    return (
      <PageBody width="form">
        <ErrorAlert error={incident.error} />
      </PageBody>
    );
  }

  if (!incident.data) return <PageSpinner />;

  return <IncidentPage incident={incident.data} />;
}
