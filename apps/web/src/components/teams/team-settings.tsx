"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { useInvalidateIncidents } from "@/components/incidents/incident-queries";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader } from "@/components/ui/page";
import { SettingRow } from "@/components/ui/setting-row";
import { linkClasses } from "@/components/ui/link";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type { TeamResponse, UpdateTeamRequest } from "@/lib/api/contracts";
import { deleteTeam, updateTeam } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { teamHref, teamsHref, useTeam } from "./team-scope";
import { NAME_TAKEN_MESSAGE } from "./teams-view";

const ownsServicesError = (error: unknown) =>
  isApiError(error, 409) && error.code === ApiErrorCode.TEAM_OWNS_SERVICES;

/**
 * Incidents name the team. Not known in advance — no incident count is
 * loaded for a team — so it is learned from the refused delete.
 */
const hasIncidentsError = (error: unknown) =>
  isApiError(error, 409) && error.code === ApiErrorCode.TEAM_HAS_INCIDENTS;

function EditTeamForm() {
  const organization = useOrganization();
  const team = useTeam();
  const queryClient = useQueryClient();
  const invalidateIncidents = useInvalidateIncidents();
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
      // Every service embeds its owner's name, and every incident its
      // responsible team's.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.services(organization.id),
        exact: true,
      });
      void invalidateIncidents(organization.id);
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

      // Services were assigned to it since this page loaded: refresh the
      // count, which turns this section into the explanation below.
      if (ownsServicesError(error)) {
        setConfirming(false);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.teams(organization.id),
          exact: true,
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.services(organization.id),
          exact: true,
        });
      }
    },
  });

  const consequence =
    team.memberCount === 0
      ? "It has no members."
      : `Its ${team.memberCount === 1 ? "1 member" : `${team.memberCount} members`} will be taken off it and stay in the organization.`;

  const description = (
    <p>
      Removes the team. Its members stay in the organization. A team that owns
      services cannot be deleted until they are moved to another team, and a
      team that has been responsible for an incident cannot be deleted at all.
      This cannot be undone.
    </p>
  );

  if (team.serviceCount > 0) {
    const owned =
      team.serviceCount === 1 ? "1 service" : `${team.serviceCount} services`;

    return (
      <SettingRow title="Delete team" description={description}>
        <Alert tone="info" title="This team owns services">
          <p>
            It owns {owned}. Move {team.serviceCount === 1 ? "it" : "them"} to
            another team before deleting this one.{" "}
            <Link
              href={teamHref(organization.slug, team.slug)}
              className={linkClasses}
            >
              See its services
            </Link>
          </p>
        </Alert>
      </SettingRow>
    );
  }

  if (hasIncidentsError(remove.error)) {
    return (
      <SettingRow title="Delete team" description={description}>
        <Alert tone="info" title="This team has incident history">
          <p>
            It has been responsible for incidents, which keep it as their
            history, so it cannot be deleted. It can still be renamed.
          </p>
        </Alert>
      </SettingRow>
    );
  }

  return (
    <SettingRow title="Delete team" description={description}>
      {remove.isError && !isApiError(remove.error, 404) && (
        <ErrorAlert
          error={remove.error}
          message={
            ownsServicesError(remove.error)
              ? "This team now owns services. Move them to another team before deleting it."
              : undefined
          }
          className="mb-4"
        />
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
  const team = useTeam();
  const canManage = useCan(Permission.TEAMS_MANAGE);

  return (
    <>
      <PageHeader
        eyebrow={team.name}
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
