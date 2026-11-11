"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Boxes,
  CalendarDays,
  ChevronRight,
  Network,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { initialsOf } from "@/components/app/shell-utilities";
import { MemberResponses } from "@/components/incidents/member-responses";
import { CriticalityMark } from "@/components/services/criticality-mark";
import { serviceHref } from "@/components/services/service-scope";
import { teamHref, teamsHref } from "@/components/teams/team-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { RoleBadge } from "@/components/roles/role-meta";
import {
  CardRow,
  DetailCard,
  Glance,
  GlanceTile,
} from "@/components/ui/detail-layout";
import { EmptyNote, EmptyState } from "@/components/ui/empty-state";
import { linkClasses } from "@/components/ui/link";
import { PageBody, PageHeader } from "@/components/ui/page";
import { PageSpinner, Spinner } from "@/components/ui/spinner";
import { Permission } from "@/lib/api/contracts";
import type {
  OrganizationMembershipResponse,
  ServiceResponse,
} from "@/lib/api/contracts";
import { getMembership, listServices } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { useCurrentUser } from "@/lib/auth/session-provider";

import { formatDate, formatRole } from "./format";
import { membersHref } from "./member-paths";
import { useCan, useOrganization } from "./organization-scope";

type Member = OrganizationMembershipResponse;

const useMembership = (organizationId: string, membershipId: string) =>
  useQuery({
    queryKey: queryKeys.membership(organizationId, membershipId),
    queryFn: () => getMembership(organizationId, membershipId),
  });

const BADGE =
  "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

const LIST_ROW =
  "flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-(--duration-fast) hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5";

function MemberNotFound({ orgSlug }: { orgSlug: string }) {
  const canReadEveryone = useCan(Permission.MEMBERSHIPS_READ_ALL);

  return (
    <PageBody width="form">
      <EmptyState
        className="mt-6"
        headingLevel={1}
        title="Member not found"
        action={
          canReadEveryone ? (
            <Link href={membersHref(orgSlug)} className={`text-sm ${linkClasses}`}>
              All members
            </Link>
          ) : (
            <Link href={teamsHref(orgSlug)} className={`text-sm ${linkClasses}`}>
              Your teams
            </Link>
          )
        }
      >
        <p>There is no such member in this organization.</p>
      </EmptyState>
    </PageBody>
  );
}

/**
 * The teams they are on, each with what it owns. Read only: placement is
 * changed from the Members list's Action column, and this card says so.
 */
function Teams({
  member,
  services,
}: {
  member: Member;
  services: ServiceResponse[] | undefined;
}) {
  const organization = useOrganization();
  const canPlace = useCan(Permission.TEAMS_MANAGE);
  const first = member.user.name.split(/\s+/)[0];

  return (
    <DetailCard
      id="teams"
      title="Teams"
      meta={member.teams.length}
      footer={
        canPlace ? (
          <>
            To add {first} to a team or take them off one, use the Action
            column on{" "}
            <Link href={membersHref(organization.slug)} className={linkClasses}>
              Members
            </Link>
            .
          </>
        ) : (
          "Teams are changed by an Admin."
        )
      }
    >
      {member.teams.length === 0 ? (
        <EmptyNote title="Not on any team yet">
          {member.role === "RESPONDER"
            ? `${first} responds to incidents through their teams.`
            : "An Admin oversees every team without being on one."}
        </EmptyNote>
      ) : (
        <ul aria-label={`Teams of ${member.user.name}`} className="divide-y divide-line-subtle">
          {member.teams.map((team) => {
            const owned = services
              ?.filter((service) => service.ownerTeam.id === team.id)
              .map(({ name }) => name);

            return (
              <li key={team.id}>
                <Link href={teamHref(organization.slug, team.slug)} className={LIST_ROW}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-fg">
                      {team.name}
                    </span>
                    {owned && (
                      <span className="truncate text-xs text-fg-subtle">
                        {owned.length === 0
                          ? "Owns no services yet"
                          : `Owns ${owned.join(", ")}`}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-fg-subtle"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DetailCard>
  );
}

/** What their teams own: the services whose incidents they respond to. */
function RespondsTo({
  member,
  services,
  error,
}: {
  member: Member;
  services: ServiceResponse[] | undefined;
  error: unknown;
}) {
  const organization = useOrganization();
  const first = member.user.name.split(/\s+/)[0];
  const teamIds = new Set(member.teams.map(({ id }) => id));
  const covered = services?.filter((service) =>
    teamIds.has(service.ownerTeam.id),
  );

  return (
    <DetailCard
      id="responds-to"
      title="Responds to"
      meta={covered && `${covered.length} ${covered.length === 1 ? "service" : "services"}`}
      footer={`Follows from ${first}'s teams: change the teams to change this.`}
    >
      {error ? (
        <div className="p-4">
          <ErrorAlert error={error} />
        </div>
      ) : !covered ? (
        <Spinner label="Loading services…" />
      ) : covered.length === 0 ? (
        <EmptyNote title="No services yet">
          {member.teams.length === 0
            ? "People respond through their teams."
            : "Their teams own no services yet."}
        </EmptyNote>
      ) : (
        <ul
          aria-label={`Services ${member.user.name} responds to`}
          className="divide-y divide-line-subtle"
        >
          {covered.map((service) => (
            <li key={service.id}>
              <Link href={serviceHref(organization.slug, service.slug)} className={LIST_ROW}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-fg">
                    {service.name}
                  </span>
                  <span className="truncate text-xs text-fg-subtle">
                    via {service.ownerTeam.name}
                  </span>
                </span>
                <CriticalityMark criticality={service.criticality} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}

function MemberPage({ member }: { member: Member }) {
  const organization = useOrganization();
  const me = useCurrentUser();
  const canReadIncidents = useCan(Permission.INCIDENTS_READ);
  const canOverseeIncidents = useCan(Permission.INCIDENTS_READ_ALL);
  const canReadServices = useCan(Permission.SERVICES_READ);
  const canPlace = useCan(Permission.TEAMS_MANAGE);
  // Account setup is for whoever sets accounts up; the API sends no one
  // else the status, and nothing here suggests it.
  const canManageMembers = useCan(Permission.MEMBERS_MANAGE);
  const canReadEveryone = useCan(Permission.MEMBERSHIPS_READ_ALL);
  // Whether their account is still waiting on its first sign-in, when told.
  const setup = member.user.passwordChangeRequired;
  // The Services pages' own query, by key — asked only when it may be read.
  const services = useQuery({
    queryKey: queryKeys.services(organization.id),
    queryFn: () => listServices(organization.id),
    enabled: canReadServices,
  });
  // A person's operational history is their own, or oversight's: the API
  // answers another member's only to `incidents:read-all`, and hides the rest
  // behind a 404. Advice, as every useCan is — but asked here so a member is
  // not shown a panel whose request would be refused.
  const isSelf = member.id === organization.membership.id;
  const canReadTheirHistory =
    canReadIncidents && (isSelf || canOverseeIncidents);
  const isYou = member.user.id === me.data?.id;
  const first = member.user.name.split(/\s+/)[0];
  const teamIds = new Set(member.teams.map(({ id }) => id));
  const covered = services.data?.filter((service) =>
    teamIds.has(service.ownerTeam.id),
  );

  return (
    <>
      <PageHeader
        width="full"
        eyebrow={
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2">
              <li>
                {/* Where they came from: the directory, or a member's teams. */}
                <Link
                  href={
                    canReadEveryone
                      ? membersHref(organization.slug)
                      : teamsHref(organization.slug)
                  }
                  className="rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {canReadEveryone ? "Members" : "Teams"}
                </Link>
              </li>
              <li aria-hidden="true" className="text-fg-subtle">
                /
              </li>
              <li aria-current="page" className="text-fg-muted">
                {member.user.name}
              </li>
            </ol>
          </nav>
        }
        title={
          <span className="flex items-center gap-3.5">
            <span
              aria-hidden="true"
              className="grid size-12 shrink-0 place-items-center rounded-full border border-accent-line bg-accent-subtle text-base font-semibold text-accent-text"
            >
              {initialsOf(member.user.name)}
            </span>
            {member.user.name}
          </span>
        }
        meta={isYou ? "You" : undefined}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-all">{member.user.email}</span>
            <span aria-hidden="true">·</span>
            <RoleBadge role={member.role} />
            {/* Only whoever sets accounts up is sent this. */}
            {setup === undefined ? null : setup ? (
              <span
                className={cx(
                  BADGE,
                  "border-warning-line bg-warning-subtle text-warning-text",
                )}
              >
                Awaiting first sign-in
              </span>
            ) : (
              <span
                className={cx(
                  BADGE,
                  "border-success-line bg-success-subtle text-success-text",
                )}
              >
                Active
              </span>
            )}
          </span>
        }
      />
      <PageBody width="full">
        <div className="flex flex-col gap-6">
          {canManageMembers &&
            member.role === "RESPONDER" &&
            member.teams.length === 0 && (
            <Alert tone="warning" title={`${first} is on no team`}>
              <p>
                So {first} sees no incidents and can respond to none.
                {canPlace && (
                  <>
                    {" "}
                    Add them to a team from the Action column on{" "}
                    <Link
                      href={membersHref(organization.slug)}
                      className={linkClasses}
                    >
                      Members
                    </Link>
                    .
                  </>
                )}
              </p>
            </Alert>
          )}
          {/* Facts about the person, never measures of them. */}
          <Glance label={`${member.user.name} at a glance`} columns={4}>
            <GlanceTile
              label="Role"
              icon={BadgeCheck}
              tone="neutral"
              value={formatRole(member.role)}
            />
            <GlanceTile
              label="Teams"
              icon={Network}
              tone="accent"
              value={member.teams.length}
            />
            <GlanceTile
              label="Services covered"
              icon={Boxes}
              tone="info"
              value={canReadServices ? (covered?.length ?? "–") : "–"}
            />
            <GlanceTile
              label="Joined"
              icon={CalendarDays}
              tone="resolved"
              value={formatDate(member.createdAt)}
            />
          </Glance>
          <CardRow layout="halves">
            <Teams member={member} services={services.data} />
            {canReadServices ? (
              <RespondsTo
                member={member}
                services={services.data}
                error={services.isError ? services.error : null}
              />
            ) : (
              <div />
            )}
          </CardRow>
          {canReadTheirHistory && (
            <MemberResponses membershipId={member.id} name={first} />
          )}
        </div>
      </PageBody>
    </>
  );
}

/**
 * One member, read only: who they are, the teams they are on, what those
 * teams own, and — for themselves or oversight — the incidents they worked.
 * Placement is changed from the Members list's Action column, one place for
 * it; this page says where.
 */
export function MemberDetail() {
  const organization = useOrganization();
  const { membershipId } = useParams<{ membershipId: string }>();
  const member = useMembership(organization.id, membershipId);

  if (isApiError(member.error, 404)) {
    return <MemberNotFound orgSlug={organization.slug} />;
  }

  if (member.isError) {
    return (
      <PageBody width="form">
        <ErrorAlert error={member.error} />
      </PageBody>
    );
  }

  if (!member.data) return <PageSpinner />;

  return <MemberPage member={member.data} />;
}
