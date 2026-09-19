"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { useMemberships } from "@/components/organizations/membership-list";
import { CriticalityMark } from "@/components/services/criticality-mark";
import { serviceHref, useServices } from "@/components/services/service-scope";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyNote } from "@/components/ui/empty-state";
import { PageBody, PageHeader, Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { IsoDate } from "@/components/ui/timestamp";
import { quietLinkClasses } from "@/components/ui/link";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type { TeamMemberResponse } from "@/lib/api/contracts";
import {
  addTeamMember,
  listTeamMembers,
  removeTeamMember,
} from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { teamHref, useTeam } from "./team-scope";

const useTeamMembers = (organizationId: string, teamId: string) =>
  useQuery({
    queryKey: queryKeys.teamMembers(organizationId, teamId),
    queryFn: () => listTeamMembers(organizationId, teamId),
  });

/**
 * What a member change stales: who is on the team, and the team list, which
 * carries the count. Also run after a 404 or 409, which means the page was
 * out of date — the list refresh is what turns a deleted team into the
 * not-found page.
 */
const useRefreshTeam = (organizationId: string, teamId: string) => {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.teamMembers(organizationId, teamId),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.teams(organizationId),
      exact: true,
    });
  };
};

const isStale = (error: unknown) =>
  isApiError(error, 404) || isApiError(error, 409);

const addErrorMessage = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.ALREADY_A_TEAM_MEMBER:
      return "That person is already on this team. The list has been refreshed.";
    case ApiErrorCode.MEMBERSHIP_NOT_FOUND:
      return "That person is no longer a member of this organization.";
    case ApiErrorCode.PERMISSION_DENIED:
      return "You do not have permission to change this team.";
    default:
      return undefined;
  }
};

function AddMemberForm({ members }: { members: TeamMemberResponse[] }) {
  const organization = useOrganization();
  const team = useTeam();
  const memberships = useMemberships(organization.id);
  const refresh = useRefreshTeam(organization.id, team.id);
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: (membershipId: string) =>
      addTeamMember(organization.id, team.id, membershipId),
    onSuccess: refresh,
    onError: (error) => {
      if (!isStale(error)) return;

      refresh();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memberships(organization.id),
        exact: true,
      });
    },
  });

  if (memberships.isError) return <ErrorAlert error={memberships.error} />;
  if (!memberships.data) return <Spinner label="Loading members…" />;

  const onTeam = new Set(members.map(({ membershipId }) => membershipId));
  const available = memberships.data.filter(({ id }) => !onTeam.has(id));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const membershipId = String(
      new FormData(event.currentTarget).get("membershipId") ?? "",
    );

    if (membershipId) add.mutate(membershipId);
  };

  return (
    <div className="flex flex-col gap-3">
      {add.isError && (
        <ErrorAlert error={add.error} message={addErrorMessage(add.error)} />
      )}
      {available.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Everyone in this organization is on this team.
        </p>
      ) : (
        <form
          onSubmit={onSubmit}
          className="flex max-w-xl flex-wrap items-end gap-3"
        >
          <div className="min-w-56 flex-1">
            <Select label="Organization member" name="membershipId">
              {available.map((membership) => (
                <option key={membership.id} value={membership.id}>
                  {membership.user.name} ({membership.user.email})
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

function MemberList({
  members,
  canManage,
}: {
  members: TeamMemberResponse[];
  canManage: boolean;
}) {
  const organization = useOrganization();
  const team = useTeam();
  const refresh = useRefreshTeam(organization.id, team.id);
  const remove = useMutation({
    mutationFn: (membershipId: string) =>
      removeTeamMember(organization.id, team.id, membershipId),
    onSuccess: refresh,
    onError: (error) => {
      if (isStale(error)) refresh();
    },
  });
  const [removingId, setRemovingId] = useState<string | null>(null);

  const onRemove = (membershipId: string) => {
    setRemovingId(membershipId);
    remove.mutate(membershipId, { onSettled: () => setRemovingId(null) });
  };

  return (
    <>
      {remove.isError &&
        (isStale(remove.error) ? (
          <Alert tone="info">
            That person was no longer on this team. The list has been
            refreshed.
          </Alert>
        ) : (
          <ErrorAlert error={remove.error} />
        ))}
      {members.length === 0 ? (
        <EmptyNote title="No one is on this team yet">
          Members added to the team are listed here.
        </EmptyNote>
      ) : (
        <Table label="Team members">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH className="hidden sm:table-cell">Email</TH>
              <TH className="hidden sm:table-cell">Added</TH>
              {canManage && (
                <TH align="end">
                  <span className="sr-only">Actions</span>
                </TH>
              )}
            </TR>
          </THead>
          <TBody>
            {members.map((member) => (
              <TR key={member.membershipId}>
                <TD>
                  <span className="font-medium">{member.user.name}</span>
                  {/* On narrow screens the email folds under the name. */}
                  <span className="block truncate text-xs text-fg-muted sm:hidden">
                    {member.user.email}
                  </span>
                </TD>
                <TD kind="muted" className="hidden sm:table-cell">
                  {member.user.email}
                </TD>
                <TD kind="data" className="hidden sm:table-cell">
                  <IsoDate value={member.addedAt} />
                </TD>
                {canManage && (
                  <TD kind="actions">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={removingId === member.membershipId}
                      onClick={() => onRemove(member.membershipId)}
                      aria-label={`Remove ${member.user.name} from ${team.name}`}
                    >
                      {removingId === member.membershipId
                        ? "Removing…"
                        : "Remove"}
                    </Button>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}

function Members({ canManage }: { canManage: boolean }) {
  const organization = useOrganization();
  const team = useTeam();
  const members = useTeamMembers(organization.id, team.id);

  return (
    <Section id="members" title="Members" meta={members.data?.length}>
      {members.isError ? (
        <ErrorAlert error={members.error} />
      ) : !members.data ? (
        <Spinner label="Loading team members…" />
      ) : (
        <>
          {canManage && <AddMemberForm members={members.data} />}
          <MemberList members={members.data} canManage={canManage} />
        </>
      )}
    </Section>
  );
}

/**
 * The services this team owns, read from the organization's service list —
 * the one the Services pages use, so there is one cache to keep current.
 */
function OwnedServices() {
  const organization = useOrganization();
  const team = useTeam();
  const services = useServices(organization.id);
  const owned = services.data?.filter(
    (service) => service.ownerTeam.id === team.id,
  );

  return (
    <Section id="services" title="Services" meta={owned?.length}>
      {services.isError ? (
        <ErrorAlert error={services.error} />
      ) : !owned ? (
        <Spinner label="Loading services…" />
      ) : owned.length === 0 ? (
        <EmptyNote title="This team owns no services">
          A service names its owner team when it is created or edited.
        </EmptyNote>
      ) : (
        <Table label="Services owned by this team">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Criticality</TH>
            </TR>
          </THead>
          <TBody>
            {owned.map((service) => (
              <TR key={service.id}>
                <TD>
                  <Link
                    href={serviceHref(organization.slug, service.slug)}
                    className={`font-medium text-fg ${quietLinkClasses}`}
                  >
                    {service.name}
                  </Link>
                  {service.archivedAt && (
                    <span className="text-fg-muted"> (archived)</span>
                  )}
                </TD>
                <TD>
                  <CriticalityMark criticality={service.criticality} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}

/** A team: its name, what it is for, who is on it, and what it owns. */
export function TeamDetail() {
  const organization = useOrganization();
  const team = useTeam();
  const canManage = useCan(Permission.TEAMS_MANAGE);
  const canReadServices = useCan(Permission.SERVICES_READ);

  return (
    <>
      <PageHeader
        width="list"
        title={team.name}
        description={team.description ?? undefined}
        actions={
          canManage && (
            <Link
              href={`${teamHref(organization.slug, team.slug)}/settings`}
              className={buttonClasses({ variant: "secondary" })}
            >
              Settings
            </Link>
          )
        }
      />
      <PageBody width="list">
        <Members canManage={canManage} />
        {canReadServices && <OwnedServices />}
      </PageBody>
    </>
  );
}
