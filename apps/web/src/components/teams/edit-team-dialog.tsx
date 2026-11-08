"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { useInvalidateIncidents } from "@/components/incidents/incident-queries";
import { useOrganization } from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { linkClasses } from "@/components/ui/link";
import { ApiErrorCode } from "@/lib/api/contracts";
import type { TeamResponse, UpdateTeamRequest } from "@/lib/api/contracts";
import { deleteTeam, updateTeam } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { NAME_TAKEN_MESSAGE } from "./create-team-form";
import { teamHref } from "./team-scope";

const ownsServicesError = (error: unknown) =>
  isApiError(error, 409) && error.code === ApiErrorCode.TEAM_OWNS_SERVICES;

/**
 * Incidents name the team. Not known in advance — no incident count is
 * loaded for a team — so it is learned from the refused delete.
 */
const hasIncidentsError = (error: unknown) =>
  isApiError(error, 409) && error.code === ApiErrorCode.TEAM_HAS_INCIDENTS;

/** The team list, refreshed: what a change, or a stale page, calls for. */
const useRefreshTeams = () => {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return () =>
    void queryClient.invalidateQueries({
      queryKey: queryKeys.teams(organization.id),
      exact: true,
    });
};

function EditTeamForm({
  team,
  onSaved,
  onCancel,
}: {
  team: TeamResponse;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const invalidateIncidents = useInvalidateIncidents();
  const refreshTeams = useRefreshTeams();
  const update = useMutation({
    mutationFn: (body: UpdateTeamRequest) =>
      updateTeam(organization.id, team.id, body),
    onSuccess: (updated) => {
      // The slug never changes, so every address to it stays good.
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
      onSaved();
    },
    onError: (error) => {
      if (isApiError(error, 404)) refreshTeams();
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    update.mutate({
      name: String(data.get("name") ?? ""),
      description: String(data.get("description") ?? ""),
    });
  };

  const nameTaken =
    isApiError(update.error, 409) &&
    update.error.code === ApiErrorCode.TEAM_NAME_TAKEN;
  const fields = fieldErrorsOf(update.error);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {update.isError && !nameTaken && Object.keys(fields).length === 0 && (
        <ErrorAlert error={update.error} />
      )}
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
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Deleting the team, set apart at the dialog's foot. While the team owns
 * services, or once it is known to have incident history, it says why it
 * cannot be deleted instead of offering to.
 */
function DeleteTeam({
  team,
  confirming,
  setConfirming,
  onDeleted,
}: {
  team: TeamResponse;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  onDeleted: () => void;
}) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const refreshTeams = useRefreshTeams();
  // Gone either way — deleted now, or already (404): close, and the list,
  // refreshed, no longer has it.
  const gone = () => {
    onDeleted();
    refreshTeams();
  };
  const remove = useMutation({
    mutationFn: () => deleteTeam(organization.id, team.id),
    onSuccess: gone,
    onError: (error) => {
      if (isApiError(error, 404)) gone();

      // Services were assigned to it since the list loaded: refresh the
      // count, which turns this section into the explanation below.
      if (ownsServicesError(error)) {
        setConfirming(false);
        refreshTeams();
        void queryClient.invalidateQueries({
          queryKey: queryKeys.services(organization.id),
          exact: true,
        });
      }
    },
  });

  const owned =
    team.serviceCount === 1 ? "1 service" : `${team.serviceCount} services`;
  const consequence =
    team.memberCount === 0
      ? "It has no members."
      : `Its ${team.memberCount === 1 ? "1 member" : `${team.memberCount} members`} will be taken off it and stay in the organization.`;

  let body;

  if (team.serviceCount > 0) {
    body = (
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
    );
  } else if (hasIncidentsError(remove.error)) {
    body = (
      <Alert tone="info" title="This team has incident history">
        <p>
          It has been responsible for incidents, which keep it as their
          history, so it cannot be deleted. It can still be renamed.
        </p>
      </Alert>
    );
  } else if (confirming) {
    body = (
      <Alert tone="warning" title={`Delete ${team.name}?`}>
        <p>{consequence} This cannot be undone.</p>
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
    );
  } else {
    body = (
      <div>
        <Button variant="destructive" onClick={() => setConfirming(true)}>
          Delete team…
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="delete-team-title"
      className="-mx-5 -mb-5 mt-6 flex flex-col gap-3 border-t border-line bg-sunken px-5 pt-4 pb-5"
    >
      <div className="flex flex-col gap-0.5">
        <h3 id="delete-team-title" className="text-sm font-semibold text-danger-text">
          Delete team
        </h3>
        <p className="text-sm text-fg-muted">
          Removes {team.name} for good. Its members stay in the organization.
        </p>
      </div>
      {remove.isError &&
        !isApiError(remove.error, 404) &&
        !hasIncidentsError(remove.error) && (
          <ErrorAlert
            error={remove.error}
            message={
              ownsServicesError(remove.error)
                ? "This team now owns services. Move them to another team before deleting it."
                : undefined
            }
          />
        )}
      {body}
    </section>
  );
}

/**
 * Editing a team from the Teams list: its name and description, and —
 * apart, at the foot — deleting it. The team is read from the list as it
 * stands, so a change made meanwhile shows; if the team goes, so does the
 * dialog.
 */
export function EditTeamDialog({
  team,
  onClose,
}: {
  team: TeamResponse;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <FormDialog
      title="Edit team"
      description={`Shown wherever ${team.name} appears. Its address stays the same.`}
      onClose={onClose}
      // A delete half-confirmed is not lost to a stray click.
      closeOnBackdrop={!confirming}
    >
      <EditTeamForm team={team} onSaved={onClose} onCancel={onClose} />
      <DeleteTeam
        team={team}
        confirming={confirming}
        setConfirming={setConfirming}
        onDeleted={onClose}
      />
    </FormDialog>
  );
}
