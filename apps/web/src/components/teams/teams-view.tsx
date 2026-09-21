"use client";

import Link from "next/link";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { quietLinkClasses } from "@/components/ui/link";
import { Permission } from "@/lib/api/contracts";

import { newTeamHref, teamHref, useTeams } from "./team-scope";

function TeamList({ canCreate }: { canCreate: boolean }) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);

  if (teams.isError) return <ErrorAlert error={teams.error} />;
  if (!teams.data) return <Spinner label="Loading teams…" />;

  if (teams.data.length === 0) {
    return (
      <EmptyState
        title="No teams yet"
        action={
          canCreate && (
            <Link
              href={newTeamHref(organization.slug)}
              className={buttonClasses({ variant: "secondary" })}
            >
              New team
            </Link>
          )
        }
      >
        <p>
          Teams group the members of this organization who work together.
          {canCreate ? "" : " An owner or admin can create one."}
        </p>
      </EmptyState>
    );
  }

  return (
    <Table label="Teams">
      <THead>
        <TR>
          <TH>Name</TH>
          <TH align="end">Members</TH>
          <TH align="end">Services</TH>
        </TR>
      </THead>
      <TBody>
        {teams.data.map((team) => (
          <TR key={team.id}>
            <TD>
              <Link
                href={teamHref(organization.slug, team.id)}
                className={`font-medium text-fg ${quietLinkClasses}`}
              >
                {team.name}
              </Link>
              {/* What it is for, as the name's second line. */}
              {team.description && (
                <span className="block max-w-xl truncate text-sm text-fg-subtle">
                  {team.description}
                </span>
              )}
            </TD>
            <TD kind="numeric" align="end">
              {team.memberCount}
            </TD>
            <TD kind="numeric" align="end">
              {team.serviceCount}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/**
 * The Teams page: every team, and — for those the API says may manage teams —
 * a way to create one, on a page of its own reached from the header.
 */
export function TeamsView() {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const canManage = useCan(Permission.TEAMS_MANAGE);

  return (
    <>
      <PageHeader
        width="list"
        title="Teams"
        meta={teams.data?.length}
        description="Groups of this organization's members. Belonging to a team grants no extra access."
        actions={
          canManage && (
            <Link
              href={newTeamHref(organization.slug)}
              className={buttonClasses()}
            >
              New team
            </Link>
          )
        }
      />
      <PageBody width="list">
        <TeamList canCreate={canManage} />
      </PageBody>
    </>
  );
}
