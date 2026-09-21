"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader } from "@/components/ui/page";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type { CreateTeamRequest, TeamResponse } from "@/lib/api/contracts";
import { createTeam } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { teamsHref } from "./team-scope";

export const NAME_TAKEN_MESSAGE =
  "A team with this name, or a very similar one, already exists.";

/**
 * Creates a team. The new team is put into the cached list before navigating
 * back to it, so the list shows the team without waiting for a refetch.
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

function CreateTeamForm() {
  const organization = useOrganization();
  const router = useRouter();
  const create = useCreateTeam(organization.id);
  const backHref = teamsHref(organization.slug);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    create.mutate(
      {
        name: String(data.get("name") ?? ""),
        description: String(data.get("description") ?? ""),
      },
      { onSuccess: () => router.push(backHref) },
    );
  };

  const nameTaken =
    isApiError(create.error, 409) &&
    create.error.code === ApiErrorCode.TEAM_NAME_TAKEN;
  const fields = fieldErrorsOf(create.error);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
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
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create team"}
        </Button>
        <Link href={backHref} className={buttonClasses({ variant: "quiet" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * Creating a team, on a page of its own. The way back to Teams is the eyebrow
 * above the title, and Cancel beside the form's action; creating returns
 * there too.
 */
export function NewTeamView() {
  const organization = useOrganization();
  // Advice only: the API refuses anyone without teams:manage regardless.
  const canManage = useCan(Permission.TEAMS_MANAGE);

  return (
    <>
      <PageHeader
        width="form"
        eyebrow={
          <Link
            href={teamsHref(organization.slug)}
            className="rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            ← Teams
          </Link>
        }
        title="New team"
        description="Group members who work together. Belonging to a team grants no extra access."
      />
      <PageBody width="form">
        {canManage ? (
          <CreateTeamForm />
        ) : (
          <Alert tone="info">
            Only an owner or admin can create teams in this organization.
          </Alert>
        )}
      </PageBody>
    </>
  );
}
