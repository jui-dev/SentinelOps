"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader, Section } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type { CreateTeamRequest, TeamResponse } from "@/lib/api/contracts";
import { createTeam } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { teamHref, useTeams } from "./team-scope";

export const NAME_TAKEN_MESSAGE =
  "A team with this name, or a very similar one, already exists.";

/**
 * Creates a team. The new team is put into the cached list before navigating
 * to it, so its page resolves the slug without waiting for a refetch.
 */
const useCreateTeam = (organizationId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateTeamRequest) => createTeam(organizationId, body),
    onSuccess: (created) => {
      queryClient.setQueryData<TeamResponse[]>(
        queryKeys.teams(organizationId),
        (current) => (current ? [...current, created] : current),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teams(organizationId),
        exact: true,
      });
    },
  });
};

function CreateTeamForm({ onCancel }: { onCancel: () => void }) {
  const organization = useOrganization();
  const router = useRouter();
  const create = useCreateTeam(organization.id);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    create.mutate(
      {
        name: String(data.get("name") ?? ""),
        description: String(data.get("description") ?? ""),
      },
      {
        onSuccess: (created) =>
          router.push(teamHref(organization.slug, created.slug)),
      },
    );
  };

  const nameTaken =
    isApiError(create.error, 409) &&
    create.error.code === ApiErrorCode.TEAM_NAME_TAKEN;
  const fields = fieldErrorsOf(create.error);

  return (
    <Section
      id="new-team"
      title="New team"
      description="Group members who work together. Belonging to a team grants no extra access."
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex max-w-xl flex-col gap-4"
      >
        {create.isError && !nameTaken && Object.keys(fields).length === 0 && (
          <ErrorAlert error={create.error} />
        )}
        <Field
          label="Name"
          name="name"
          required
          maxLength={100}
          autoComplete="off"
          error={nameTaken ? NAME_TAKEN_MESSAGE : fields.name}
        />
        <Field
          label="Description"
          name="description"
          optional
          maxLength={500}
          autoComplete="off"
          hint="What the team is responsible for."
          error={fields.description}
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create team"}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}

function TeamList({ onCreate }: { onCreate?: () => void }) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);

  if (teams.isError) return <ErrorAlert error={teams.error} />;
  if (!teams.data) return <Spinner label="Loading teams…" />;

  if (teams.data.length === 0) {
    return (
      <EmptyState
        title="No teams yet"
        action={
          onCreate && (
            <Button variant="secondary" onClick={onCreate}>
              New team
            </Button>
          )
        }
      >
        <p>
          Teams group the members of this organization who work together.
          {onCreate ? "" : " An owner or admin can create one."}
        </p>
      </EmptyState>
    );
  }

  return (
    <Table label="Teams" density="compact">
      <THead>
        <TR>
          <TH>Name</TH>
          <TH className="hidden md:table-cell">Description</TH>
          <TH align="end">Members</TH>
        </TR>
      </THead>
      <TBody>
        {teams.data.map((team) => (
          <TR key={team.id}>
            <TD>
              <Link
                href={teamHref(organization.slug, team.slug)}
                className="font-medium text-fg underline-offset-2 hover:text-accent-text hover:underline"
              >
                {team.name}
              </Link>
            </TD>
            <TD kind="muted" className="hidden max-w-md truncate md:table-cell">
              {team.description}
            </TD>
            <TD kind="data" align="end">
              {team.memberCount}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/**
 * The Teams page: every team, and — for those the API says may manage teams —
 * a form to create one, opened from the header.
 */
export function TeamsView() {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const canManage = useCan(Permission.TEAMS_MANAGE);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow={organization.name}
        title="Teams"
        meta={teams.data?.length}
        description="Groups of this organization's members. Belonging to a team grants no extra access."
        actions={
          canManage &&
          !creating && (
            <Button onClick={() => setCreating(true)}>New team</Button>
          )
        }
      />
      <PageBody>
        {canManage && creating && (
          <CreateTeamForm onCancel={() => setCreating(false)} />
        )}
        <TeamList
          onCreate={canManage && !creating ? () => setCreating(true) : undefined}
        />
      </PageBody>
    </>
  );
}
