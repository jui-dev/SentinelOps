"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Permission } from "@/lib/api/contracts";

import { CreateTeamForm } from "./create-team-form";
import { teamHref, useTeams } from "./team-scope";

/**
 * A row's way to its team: the accent's quiet fill, so it reads as the
 * action without competing with the page's primary button.
 */
const VIEW_ACTION =
  "inline-flex h-7 items-center gap-1 rounded-md border border-accent-line bg-accent-subtle px-2.5 text-sm font-medium text-accent-text transition-colors duration-(--duration-fast) hover:border-accent-rim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** `onCreate` is absent for those who may not manage teams. */
function TeamList({ onCreate }: { onCreate?: () => void }) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const canManage = useCan(Permission.TEAMS_MANAGE);

  if (teams.isError) return <ErrorAlert error={teams.error} />;
  if (!teams.data) return <Spinner label="Loading teams…" />;

  if (teams.data.length === 0) {
    // The API answers with the teams the caller may see, so an empty list
    // means two different things. To whoever manages teams it is the
    // organization's own answer — there are none. To everyone else it is
    // about them: they are on none, whatever the organization has.
    return (
      <EmptyState
        title={canManage ? "No teams yet" : "You are not on a team"}
        action={
          onCreate && (
            <Button variant="secondary" onClick={onCreate}>
              New team
            </Button>
          )
        }
      >
        <p>
          {canManage
            ? "Teams group the members of this organization who work together."
            : "The teams you are placed on appear here. An owner or admin can add you to one."}
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
          <TH align="end">Action</TH>
        </TR>
      </THead>
      <TBody>
        {teams.data.map((team) => (
          <TR key={team.id}>
            <TD>
              {/* Plain text: the row's one way in is its View action. */}
              <span className="font-medium text-fg">{team.name}</span>
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
            <TD kind="actions">
              <Link
                href={teamHref(organization.slug, team.slug)}
                aria-label={`View ${team.name}`}
                className={VIEW_ACTION}
              >
                View
                <ChevronRight aria-hidden="true" strokeWidth={2} className="size-3.5" />
              </Link>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/**
 * The Teams page: every team, and — for those the API says may manage teams —
 * a dialog to create one, opened from the header. Creating closes it, and the
 * new team is already in the list beneath.
 */
export function TeamsView() {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const canManage = useCan(Permission.TEAMS_MANAGE);
  const [creating, setCreating] = useState(false);
  const openCreate = () => setCreating(true);
  const close = () => setCreating(false);

  return (
    <>
      <PageHeader
        width="list"
        title="Teams"
        meta={teams.data?.length}
        description={
          canManage
            ? "Groups of this organization's members. Belonging to a team grants no extra access."
            : "The teams you are on."
        }
        actions={
          canManage && <Button onClick={openCreate}>New team</Button>
        }
      />
      <PageBody width="list">
        <TeamList onCreate={canManage ? openCreate : undefined} />
      </PageBody>
      {canManage && creating && (
        <FormDialog
          title="New team"
          description="Group members who work together. Belonging to a team grants no extra access."
          onClose={close}
        >
          <CreateTeamForm onClose={close} />
        </FormDialog>
      )}
    </>
  );
}
