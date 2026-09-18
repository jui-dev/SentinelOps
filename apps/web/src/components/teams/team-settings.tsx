"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader } from "@/components/ui/page";
import { SettingRow } from "@/components/ui/setting-row";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type { TeamResponse, UpdateTeamRequest } from "@/lib/api/contracts";
import { deleteTeam, updateTeam } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { teamsHref, useTeam } from "./team-scope";
import { NAME_TAKEN_MESSAGE } from "./teams-view";

function EditTeamForm() {
  const organization = useOrganization();
  const team = useTeam();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    mutationFn: (body: UpdateTeamRequest) =>
      updateTeam(organization.id, team.id, body),
    onSuccess: (updated) => {
      // The slug never changes, so the page stays where it is.
      queryClient.setQueryData<TeamResponse[]>(
        queryKeys.teams(organization.id),
        (current) =>
          current?.map((each) => (each.id === updated.id ? updated : each)),
      );
    },
    onError: (error) => {
      if (isApiError(error, 404)) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.teams(organization.id),
          exact: true,
        });
      }
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setSaved(false);
    update.mutate(
      {
        name: String(data.get("name") ?? ""),
        description: String(data.get("description") ?? ""),
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  const nameTaken =
    isApiError(update.error, 409) &&
    update.error.code === ApiErrorCode.TEAM_NAME_TAKEN;
  const fields = fieldErrorsOf(update.error);

  return (
    <SettingRow
      title="Name and description"
      description={<p>Shown wherever this team appears in SentinelOps.</p>}
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex max-w-md flex-col gap-4"
      >
        {update.isError && !nameTaken && Object.keys(fields).length === 0 && (
          <ErrorAlert error={update.error} />
        )}
        {saved && <Alert tone="success">Team updated.</Alert>}
        <Field
          label="Name"
          name="name"
          defaultValue={team.name}
          required
          maxLength={100}
          autoComplete="off"
          error={nameTaken ? NAME_TAKEN_MESSAGE : fields.name}
        />
        <Field
          label="Description"
          name="description"
          defaultValue={team.description ?? ""}
          optional
          maxLength={500}
          autoComplete="off"
          error={fields.description}
        />
        <div>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </SettingRow>
  );
}

function DeleteTeam() {
  const organization = useOrganization();
  const team = useTeam();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  // Gone either way — deleted now, or already (404) — so leave for the list.
  // Leave first: refreshing the list while still here would show this team's
  // page as not found on the way out.
  const leave = () => {
    router.push(teamsHref(organization.slug));
    void queryClient.invalidateQueries({
      queryKey: queryKeys.teams(organization.id),
      exact: true,
    });
  };
  const remove = useMutation({
    mutationFn: () => deleteTeam(organization.id, team.id),
    onSuccess: leave,
    onError: (error) => {
      if (isApiError(error, 404)) leave();
    },
  });

  const consequence =
    team.memberCount === 0
      ? "It has no members."
      : `Its ${team.memberCount === 1 ? "1 member" : `${team.memberCount} members`} will be taken off it and stay in the organization.`;

  return (
    <SettingRow
      title="Delete team"
      description={
        <p>
          Removes the team. Its members stay in the organization. This cannot
          be undone.
        </p>
      }
    >
      {remove.isError && !isApiError(remove.error, 404) && (
        <ErrorAlert error={remove.error} className="mb-4" />
      )}
      {confirming ? (
        <Alert tone="warning" title={`Delete ${team.name}?`}>
          <p>{consequence}</p>
          <div className="flex gap-2 pt-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Deleting…" : "Delete team"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={remove.isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </Alert>
      ) : (
        <Button variant="destructive" onClick={() => setConfirming(true)}>
          Delete team…
        </Button>
      )}
    </SettingRow>
  );
}

/** A team's settings: its name and description, and deleting it. */
export function TeamSettings() {
  const organization = useOrganization();
  const team = useTeam();
  const canManage = useCan(Permission.TEAMS_MANAGE);

  return (
    <>
      <PageHeader
        eyebrow={`${organization.name} · ${team.name}`}
        title="Team settings"
      />
      <PageBody width="form">
        {canManage ? (
          <>
            <EditTeamForm />
            <DeleteTeam />
          </>
        ) : (
          <Alert tone="info">
            You do not have permission to change this team. An owner or admin
            can change it.
          </Alert>
        )}
      </PageBody>
    </>
  );
}
