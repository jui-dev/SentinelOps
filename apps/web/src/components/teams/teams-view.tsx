"use client";

import {
  ChevronRight,
  Eye,
  Pencil,
  Plus,
} from "lucide-react";
import { Fragment, useState } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { FormDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { ListLoading } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Permission } from "@/lib/api/contracts";
import type { TeamResponse } from "@/lib/api/contracts";

import { CreateTeamForm } from "./create-team-form";
import { EditTeamDialog } from "./edit-team-dialog";
import { TeamPeek } from "./team-peek";
import { teamHref, useTeams } from "./team-scope";
import { ButtonLink } from "@/components/ui/button-link";

/** View in the accent; Edit in the info tone — as calm, told apart from it. */

/**
 * `onCreate` and `onEdit` are absent for those who may not manage teams;
 * they are offered View alone.
 */
function TeamList({
  onCreate,
  onEdit,
}: {
  onCreate?: () => void;
  onEdit?: (team: TeamResponse) => void;
}) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const canManage = useCan(Permission.TEAMS_MANAGE);
  // Any number open at once, so teams can be compared side by side.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (teamId: string) =>
    setExpanded((current) => {
      const next = new Set(current);

      if (!next.delete(teamId)) next.add(teamId);

      return next;
    });

  if (teams.isError) return <ErrorAlert error={teams.error} />;
  if (!teams.data) return <ListLoading label="Loading teams…" />;

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
            <Button icon={Plus} variant="add" onClick={onCreate}>
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
    <Table label="Teams" count={teams.data.length}
          columns={["main", "count", "count", onEdit ? "actions2" : "actions"]}
        >
      <THead>
        <TR>
          <TH>Name</TH>
          <TH align="end">Members</TH>
          <TH align="end">Services</TH>
          <TH align="end">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {teams.data.map((team) => {
          const open = expanded.has(team.id);
          const peekId = `team-peek-${team.id}`;

          return (
          <Fragment key={team.id}>
          <TR
            // A click anywhere on the row opens it, as the chevron does —
            // but not one meant for View or Edit, or the chevron itself.
            onClick={(event) => {
              if ((event.target as Element).closest("a, button")) return;
              toggle(team.id);
            }}
            className="cursor-pointer"
          >
            <TD>
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={open ? peekId : undefined}
                  aria-label={`${open ? "Hide" : "Show"} members and services of ${team.name}`}
                  onClick={() => toggle(team.id)}
                  className="-ml-1 grid size-6 shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                >
                  <ChevronRight
                    aria-hidden="true"
                    strokeWidth={2}
                    className={cx(
                      "size-4 transition-transform duration-(--duration-fast)",
                      open && "rotate-90",
                    )}
                  />
                </button>
                <div className="min-w-0">
                  <span className="font-medium text-fg">{team.name}</span>
                  {/* What it is for, as the name's second line. */}
                  {team.description && (
                    <span className="block max-w-xl truncate text-sm text-fg-subtle">
                      {team.description}
                    </span>
                  )}
                </div>
              </div>
            </TD>
            <TD kind="numeric" align="end">
              {team.memberCount}
            </TD>
            <TD kind="numeric" align="end">
              {team.serviceCount}
            </TD>
            <TD kind="actions">
              {/* One flex line, so a link and a button sit on one centre. */}
              <div className="flex items-center justify-end gap-2">
                <ButtonLink
                  href={teamHref(organization.slug, team.slug)}
                  aria-label={`View ${team.name}`}
                  variant="view"
                  size="sm"
                  icon={Eye}
                >
                  View
                </ButtonLink>
                {onEdit && (
                  <Button
                    variant="edit"
                    size="sm"
                    icon={Pencil}
                    aria-label={`Edit ${team.name}`}
                    onClick={() => onEdit(team)}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </TD>
          </TR>
          {open && (
            // A plain row, outside the table's hover: it is the row above, opened.
            <tr id={peekId}>
              <td
                colSpan={4}
                className="border-b border-line-subtle bg-sunken px-3 py-3 sm:px-4"
              >
                <TeamPeek team={team} />
              </td>
            </tr>
          )}
          </Fragment>
          );
        })}
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
  // By id, read from the list as it stands: a team deleted meanwhile, or
  // gone from the list, closes its dialog.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = teams.data?.find((team) => team.id === editingId);

  return (
    <>
      <PageHeader
        width="full"
        title="Teams"
        meta={teams.data?.length}
        description={
          canManage
            ? "Groups of this organization's members. Belonging to a team grants no extra access."
            : "The teams you are on."
        }
        actions={
          canManage && <Button icon={Plus} onClick={openCreate}>New team</Button>
        }
      />
      <PageBody width="full">
        <TeamList
          onCreate={canManage ? openCreate : undefined}
          onEdit={canManage ? (team) => setEditingId(team.id) : undefined}
        />
      </PageBody>
      {canManage && editing && (
        <EditTeamDialog
          key={editing.id}
          team={editing}
          onClose={() => setEditingId(null)}
        />
      )}
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
