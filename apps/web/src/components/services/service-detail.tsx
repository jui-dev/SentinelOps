"use client";

import { BadgeCheck, CircleCheck, History, Info, Network, Siren, Users } from "lucide-react";
import Link from "next/link";


import { initialsOf } from "@/components/app/shell-utilities";
import { countOf, worstOf } from "@/components/incidents/incident-figures";
import {
  incidentsHref,
  useIncidentList,
} from "@/components/incidents/incident-queries";
import { IncidentTable } from "@/components/incidents/incident-table";
import { INSTRUMENT } from "@/components/overview/analytical-view-header";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { teamHref, useTeamMembers } from "@/components/teams/team-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import {
  CardRow,
  DetailCard,
  Glance,
  GlanceTile,
} from "@/components/ui/detail-layout";
import type { GlanceTone } from "@/components/ui/detail-layout";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { linkClasses } from "@/components/ui/link";
import { OnwardLink } from "@/components/ui/onward-link";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { IsoDate } from "@/components/ui/timestamp";
import { Permission } from "@/lib/api/contracts";
import type {
  ServiceCriticality,
  ServiceResponse,
} from "@/lib/api/contracts";
import { isApiError } from "@/lib/api/errors";
import { lastUtcDays } from "@/lib/period/period";

import { criticalityOf } from "./criticality";
import { CriticalityMark } from "./criticality-mark";
import { servicesHref, useService } from "./service-scope";

/** How many resolved incidents the card shows; the rest are one link away. */
const RESOLVED_SHOWN = 5;

/** The days the Resolved tile counts. */
const RESOLVED_DAYS = 30;

/** The criticality tile's tone: how much the organization depends on it. */
const CRITICALITY_TONES: Record<ServiceCriticality, GlanceTone> = {
  CRITICAL: "warning",
  HIGH: "warning",
  NORMAL: "info",
  LOW: "neutral",
};

const viewAllHref = (orgSlug: string, service: ServiceResponse) =>
  `${incidentsHref(orgSlug)}?${new URLSearchParams({ service: service.slug })}`;

/** The service's incidents at a glance: active now, and resolved lately. */
function IncidentTiles({ serviceId }: { serviceId: string }) {
  const organization = useOrganization();
  // The Active card's own query, by key: one request for both.
  const active = useIncidentList(organization.id, "active", undefined, {
    serviceId,
  });
  const resolved = useIncidentList(
    organization.id,
    "resolved",
    lastUtcDays(RESOLVED_DAYS, new Date()),
    { serviceId },
  );
  const activePage = active.data?.pages[0];
  const resolvedPage = resolved.data?.pages[0];

  return (
    <>
      <GlanceTile
        label="Active incidents"
        icon={Siren}
        tone="warning"
        noteTone
        value={
          activePage ? countOf(activePage.items, activePage.page.hasMore) : "–"
        }
        note={activePage && worstOf(activePage.items)}
      />
      <GlanceTile
        label="Resolved"
        icon={CircleCheck}
        tone="resolved"
        value={
          resolvedPage
            ? countOf(resolvedPage.items, resolvedPage.page.hasMore)
            : "–"
        }
        note={`last ${RESOLVED_DAYS} days`}
      />
    </>
  );
}

function ActiveIncidents({ service }: { service: ServiceResponse }) {
  const organization = useOrganization();
  const list = useIncidentList(organization.id, "active", undefined, {
    serviceId: service.id,
  });
  const items = list.data?.pages[0]?.items;

  return (
    <DetailCard
      id="active-incidents"
      title="Active incidents"
      icon={Siren}
      family="operations"
      meta={items?.length}
      description={`${service.ownerTeam.name} is responsible for these now.`}
      action={
        <OnwardLink href={viewAllHref(organization.slug, service)}>
          View all in Incidents
        </OnwardLink>
      }
    >
      {list.isError ? (
        <div className="p-4">
          <ErrorAlert error={list.error} />
        </div>
      ) : !items ? (
        <Spinner label="Loading active incidents…" />
      ) : items.length === 0 ? (
        <EmptyNote
          title="No active incidents"
          glyph={
            <svg viewBox="0 0 10 10" className="size-2.5 text-signal-nominal">
              <circle cx="5" cy="5" r="3.75" fill="currentColor" />
            </svg>
          }
        >
          Nothing here needs a response right now.
        </EmptyNote>
      ) : (
        // Every row is this service's, and its owner's: no column says so.
        <IncidentTable
          incidents={items}
          state="active"
          label="Active incidents"
          showService={false}
          showTeam={false}
          wrapTitles
        />
      )}
    </DetailCard>
  );
}

function RecentlyResolved({ service }: { service: ServiceResponse }) {
  const organization = useOrganization();
  const list = useIncidentList(organization.id, "resolved", undefined, {
    serviceId: service.id,
  });
  const items = list.data?.pages[0]?.items;

  return (
    <DetailCard
      id="resolved-incidents"
      title="Recently resolved"
      icon={History}
      family="resolved"
      aside="Most recent first"
      description="The last incidents on this service to be resolved."
      action={
        items && items.length > 0 ? (
          <OnwardLink href={viewAllHref(organization.slug, service)}>
            View all in Incidents
          </OnwardLink>
        ) : undefined
      }
    >
      {list.isError ? (
        <div className="p-4">
          <ErrorAlert error={list.error} />
        </div>
      ) : !items ? (
        <Spinner label="Loading resolved incidents…" />
      ) : items.length === 0 ? (
        <EmptyNote title="None resolved yet">
          Resolved incidents appear here, most recent first.
        </EmptyNote>
      ) : (
        <IncidentTable
          incidents={items.slice(0, RESOLVED_SHOWN)}
          state="resolved"
          label="Recently resolved incidents"
          showService={false}
          showTeam={false}
          wrapTitles
        />
      )}
    </DetailCard>
  );
}

/**
 * Who responds to the service's incidents: the members of its owner team,
 * read only. A member may read only their own teams; for another team's
 * service the API hides its members, and this names the team instead.
 */
function WhoResponds({ service }: { service: ServiceResponse }) {
  const organization = useOrganization();
  const members = useTeamMembers(organization.id, service.ownerTeam.id);
  const team = (
    <Link
      href={teamHref(organization.slug, service.ownerTeam.slug)}
      className={linkClasses}
    >
      {service.ownerTeam.name}
    </Link>
  );

  return (
    <DetailCard
      id="who-responds"
      title="Who responds"
      icon={Users}
      family="investigating"
      meta={members.data?.length}
      description={<>The members of {team}, which owns this service.</>}
    >
      {isApiError(members.error, 404) ? (
        <p className="text-sm text-fg-muted">
          {service.ownerTeam.name} responds to this service&apos;s incidents.
        </p>
      ) : members.isError ? (
        <div className="p-4">
          <ErrorAlert error={members.error} />
        </div>
      ) : !members.data ? (
        <Spinner label="Loading responders…" />
      ) : members.data.length === 0 ? (
        <EmptyNote title="No one to respond">
          No one is on {service.ownerTeam.name} yet.
        </EmptyNote>
      ) : (
        <ul
          aria-label={`Who responds to ${service.name}`}
          className={cx(INSTRUMENT, "divide-y divide-line-subtle overflow-hidden sm:max-h-84 sm:overflow-y-auto")}
        >
          {members.data.map((member) => (
            <li
              key={member.membershipId}
              className="flex items-center gap-3 px-4 py-2.5 sm:px-5"
            >
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full border border-accent-line bg-accent-subtle text-xs font-semibold text-accent-text"
              >
                {initialsOf(member.user.name)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-fg">
                  {member.user.name}
                </span>
                <span className="truncate text-xs text-fg-subtle">
                  {member.user.email}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}

/** What the service is: what its criticality means, who owns it, when. */
function About({ service }: { service: ServiceResponse }) {
  const organization = useOrganization();
  const criticality = criticalityOf(service.criticality);

  return (
    <DetailCard
      id="about"
      title="About"
      icon={Info}
      description="How this service is set up."
    >
      <dl className={cx(INSTRUMENT, "grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 px-4 py-4 text-sm")}>
        <dt className="text-fg-subtle">Criticality</dt>
        <dd className="flex flex-col gap-1">
          <CriticalityMark criticality={service.criticality} />
          {criticality.definition && (
            <span className="text-fg-muted">{criticality.definition}</span>
          )}
        </dd>
        <dt className="text-fg-subtle">Owner team</dt>
        <dd>
          <Link
            href={teamHref(organization.slug, service.ownerTeam.slug)}
            className={linkClasses}
          >
            {service.ownerTeam.name}
          </Link>
        </dd>
        <dt className="text-fg-subtle">Created</dt>
        <dd className="data text-fg-muted">
          <IsoDate value={service.createdAt} />
        </dd>
        <dt className="text-fg-subtle">Updated</dt>
        <dd className="data text-fg-muted">
          <IsoDate value={service.updatedAt} />
        </dd>
      </dl>
    </DetailCard>
  );
}

/**
 * A service: what it is and how much depends on it, a glance at what is
 * wrong with it now, its incidents, and who responds. No health or
 * metrics: an incident is what says something is wrong with it. Read only:
 * the service is changed from the Services list, and incidents are declared
 * on the Incidents page — one place for each.
 */
export function ServiceDetail() {
  const organization = useOrganization();
  const service = useService();
  const canReadIncidents = useCan(Permission.INCIDENTS_READ);
  const canReadTeams = useCan(Permission.TEAMS_READ);
  const criticality = criticalityOf(service.criticality);

  return (
    <>
      <PageHeader
        width="full"
        eyebrow={
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2">
              <li>
                <Link
                  href={servicesHref(organization.slug)}
                  className="rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Services
                </Link>
              </li>
              <li aria-hidden="true" className="text-fg-subtle">
                /
              </li>
              <li aria-current="page" className="text-fg-muted">
                {service.name}
              </li>
            </ol>
          </nav>
        }
        title={service.name}
        meta={
          <span className="flex items-center gap-2">
            <CriticalityMark criticality={service.criticality} />
            {service.archivedAt && (
              <span className="rounded-sm border border-line px-1.5 text-xs text-fg-subtle">
                Archived
              </span>
            )}
          </span>
        }
        description={service.description ?? undefined}
      />
      <PageBody width="full">
        <div className="flex flex-col gap-6">
          {service.archivedAt && (
            <Alert tone="info" title="Archived">
              <p>
                Retired on <IsoDate value={service.archivedAt} />. It is kept
                for its incidents, and no new incident can be declared against
                it.
              </p>
            </Alert>
          )}
          <Glance
            label={`${service.name} at a glance`}
            columns={canReadIncidents ? 4 : 2}
          >
            <GlanceTile
              label="Owner team"
              icon={Network}
              tone="accent"
              value={service.ownerTeam.name}
            />
            <GlanceTile
              label="Criticality"
              icon={BadgeCheck}
              tone={CRITICALITY_TONES[service.criticality]}
              value={criticality.label}
            />
            {canReadIncidents && <IncidentTiles serviceId={service.id} />}
          </Glance>
          {canReadIncidents ? (
            <>
              <CardRow>
                <ActiveIncidents service={service} />
                {canReadTeams ? <WhoResponds service={service} /> : <div />}
              </CardRow>
              <CardRow>
                <RecentlyResolved service={service} />
                <About service={service} />
              </CardRow>
            </>
          ) : (
            <CardRow layout="halves">
              {canReadTeams && <WhoResponds service={service} />}
              <About service={service} />
            </CardRow>
          )}
        </div>
      </PageBody>
    </>
  );
}
