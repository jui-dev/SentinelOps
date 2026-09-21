"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { MemberResponses } from "@/components/incidents/member-responses";
import { teamHref, teamsHref, useTeams } from "@/components/teams/team-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { linkClasses } from "@/components/ui/link";
import { PageBody, PageHeader, Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { PageSpinner, Spinner } from "@/components/ui/spinner";
import { Status } from "@/components/ui/status";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type { OrganizationMembershipResponse } from "@/lib/api/contracts";
import {
  addTeamMember,
  getMembership,
  removeTeamMember,
} from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { useCurrentUser } from "@/lib/auth/session-provider";

import { formatRole } from "./format";
import { membersHref } from "./member-paths";
import { useCan, useOrganization } from "./organization-scope";

const useMembership = (organizationId: string, membershipId: string) =>
  useQuery({
    queryKey: queryKeys.membership(organizationId, membershipId),
    queryFn: () => getMembership(organizationId, membershipId),
  });

/**
 * After a placement changes, everything that shows it: this member's record,
 * the members list (its Teams column), and the teams — their member counts
 * and member lists, all beneath the `teams` prefix.
 */
const useRefreshPlacements = (organizationId: string, membershipId: string) => {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.membership(organizationId, membershipId),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.memberships(organizationId),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.teams(organizationId),
    });
  };
};

/** A 404 or 409 means the page was out of date, not that something broke. */
const isStale = (error: unknown) =>
  isApiError(error, 404) || isApiError(error, 409);

const addErrorMessage = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.ALREADY_A_TEAM_MEMBER:
      return "They are already on that team. The list has been refreshed.";
    case ApiErrorCode.TEAM_NOT_FOUND:
      return "That team no longer exists. The list has been refreshed.";
    case ApiErrorCode.MEMBERSHIP_NOT_FOUND:
      return "This person is no longer a member of the organization.";
    case ApiErrorCode.PERMISSION_DENIED:
      return "You do not have permission to change teams.";
    default:
      return undefined;
  }
};

/** Places the member on one of the teams they are not on yet. */
function AddToTeam({ member }: { member: OrganizationMembershipResponse }) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const refresh = useRefreshPlacements(organization.id, member.id);
  const add = useMutation({
    mutationFn: (teamId: string) =>
      addTeamMember(organization.id, teamId, member.id),
    onSuccess: refresh,
    onError: (error) => {
      if (isStale(error)) refresh();
    },
  });

  if (teams.isError) return <ErrorAlert error={teams.error} />;
  if (!teams.data) return <Spinner label="Loading teams…" />;

  if (teams.data.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        There are no teams yet.{" "}
        <Link href={teamsHref(organization.slug)} className={linkClasses}>
          Create one
        </Link>{" "}
        to give people operational responsibility.
      </p>
    );
  }

  // Only teams they are not on: the same team cannot be offered twice.
  const onTeam = new Set(member.teams.map(({ id }) => id));
  const available = teams.data.filter(({ id }) => !onTeam.has(id));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const teamId = String(new FormData(event.currentTarget).get("teamId") ?? "");

    if (teamId) add.mutate(teamId);
  };

  return (
    <div className="flex flex-col gap-3">
      {add.isError && (
        <ErrorAlert error={add.error} message={addErrorMessage(add.error)} />
      )}
      {available.length === 0 ? (
        <p className="text-sm text-fg-muted">They are on every team.</p>
      ) : (
        <form
          onSubmit={onSubmit}
          className="flex max-w-xl flex-wrap items-end gap-3"
        >
          <div className="min-w-56 flex-1">
            <Select label="Add to team" name="teamId">
              {available.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={add.isPending}>
            {add.isPending ? "Adding…" : "Add to team"}
          </Button>
        </form>
      )}
    </div>
  );
}

/** The teams the member is on, each removable by the Admin. */
function Teams({
  member,
  canManage,
}: {
  member: OrganizationMembershipResponse;
  canManage: boolean;
}) {
  const organization = useOrganization();
  const refresh = useRefreshPlacements(organization.id, member.id);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (teamId: string) =>
      removeTeamMember(organization.id, teamId, member.id),
    onSuccess: refresh,
    onError: (error) => {
      if (isStale(error)) refresh();
    },
  });

  const onRemove = (teamId: string) => {
    setRemovingId(teamId);
    remove.mutate(teamId, { onSettled: () => setRemovingId(null) });
  };

  return (
    <Section
      id="teams"
      title="Teams"
      meta={member.teams.length}
      description="The teams whose incidents they respond to."
    >
      {remove.isError &&
        (isStale(remove.error) ? (
          <Alert tone="info">
            They were no longer on that team. The list has been refreshed.
          </Alert>
        ) : (
          <ErrorAlert error={remove.error} />
        ))}
      {member.teams.length === 0 ? (
        <p className="text-sm text-fg-muted">Not on any team yet.</p>
      ) : (
        <ul className="flex max-w-xl flex-col divide-y divide-line-subtle rounded-md border border-line-subtle">
          {member.teams.map((team) => (
            <li
              key={team.id}
              className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
            >
              <Link
                href={teamHref(organization.slug, team.id)}
                className="truncate text-sm font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {team.name}
              </Link>
              {canManage && (
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={removingId === team.id}
                  onClick={() => onRemove(team.id)}
                  aria-label={`Remove ${member.user.name} from ${team.name}`}
                >
                  {removingId === team.id ? "Removing…" : "Remove"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && <AddToTeam member={member} />}
    </Section>
  );
}

function MemberNotFound({ orgSlug }: { orgSlug: string }) {
  return (
    <PageBody width="form">
      <EmptyState
        className="mt-6"
        headingLevel={1}
        title="Member not found"
        action={
          <Link href={membersHref(orgSlug)} className={`text-sm ${linkClasses}`}>
            All members
          </Link>
        }
      >
        <p>There is no such member in this organization.</p>
      </EmptyState>
    </PageBody>
  );
}

function MemberPage({ member }: { member: OrganizationMembershipResponse }) {
  const organization = useOrganization();
  const me = useCurrentUser();
  // Placing people on teams is team configuration: the Admin's, like the
  // Team page's own controls. Advice only; the API checks regardless.
  const canManage = useCan(Permission.TEAMS_MANAGE);
  const canReadIncidents = useCan(Permission.INCIDENTS_READ);
  const isYou = member.user.id === me.data?.id;

  return (
    <>
      <PageHeader
        width="form"
        eyebrow={
          <Link
            href={membersHref(organization.slug)}
            className="rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            ← Members
          </Link>
        }
        title={member.user.name}
        meta={isYou ? "You" : undefined}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-all">{member.user.email}</span>
            <span aria-hidden="true">·</span>
            <span>{formatRole(member.role)}</span>
            <span aria-hidden="true">·</span>
            {member.user.passwordChangeRequired ? (
              <Status tone="warning">Awaiting first sign-in</Status>
            ) : (
              <Status tone="neutral">Active</Status>
            )}
          </span>
        }
      />
      <PageBody width="form">
        <Teams member={member} canManage={canManage} />
        {canReadIncidents && (
          <MemberResponses membershipId={member.id} name={member.user.name} />
        )}
      </PageBody>
    </>
  );
}

/**
 * One member: who they are, and the teams they are on. The Admin places
 * them on teams and takes them off, through the same team-membership routes
 * the Team page uses; everyone else reads. The Admin's own page is no
 * different: they can be on teams like anyone.
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
