"use client";

import {
  Archive,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { useInvalidateIncidents } from "@/components/incidents/incident-queries";
import { useOrganization } from "@/components/organizations/organization-scope";
import { useTeams } from "@/components/teams/team-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import {
  RequiredNote,
  SubmitHint,
  useRequiredFields,
} from "@/components/ui/required";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ApiErrorCode } from "@/lib/api/contracts";
import type {
  ServiceCriticality,
  ServiceResponse,
  UpdateServiceRequest,
} from "@/lib/api/contracts";
import { deleteService, updateService } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import {
  CriticalitySelect,
  OWNER_TEAM_GONE_MESSAGE,
  SERVICE_NAME_TAKEN_MESSAGE,
} from "./service-form-parts";

/**
 * Changes a service. The slug never changes, so every address to it stays
 * good: the updated service replaces the cached one. Teams stale too, since
 * moving a service changes two teams' counts, and so do incidents, which
 * show the service's name, criticality, and archival. A 404 means the list
 * was out of date, and refreshing it shows why.
 */
const useUpdateService = (service: ServiceResponse) => {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const invalidateIncidents = useInvalidateIncidents();
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.services(organization.id),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.teams(organization.id),
      exact: true,
    });
  };

  return useMutation({
    mutationFn: (body: UpdateServiceRequest) =>
      updateService(organization.id, service.id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<ServiceResponse[]>(
        queryKeys.services(organization.id),
        (current) =>
          current?.map((each) => (each.id === updated.id ? updated : each)),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teams(organization.id),
        exact: true,
      });
      void invalidateIncidents(organization.id);
    },
    onError: (error) => {
      if (isApiError(error, 404)) refresh();
    },
  });
};

/** Name, description, criticality, and owner, saved together. */
function DetailsForm({
  service,
  onSaved,
  onCancel,
}: {
  service: ServiceResponse;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const update = useUpdateService(service);
  const [criticality, setCriticality] = useState<ServiceCriticality>(
    service.criticality,
  );
  const { attach: requiredRef, ...required } = useRequiredFields();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const ownerTeamId = String(data.get("ownerTeamId") ?? "");

    update.mutate(
      {
        name: String(data.get("name") ?? ""),
        description: String(data.get("description") ?? ""),
        criticality,
        // Only a change is sent: an unchanged owner asks nothing of the team.
        ...(ownerTeamId && ownerTeamId !== service.ownerTeam.id
          ? { ownerTeamId }
          : {}),
      },
      { onSuccess: onSaved },
    );
  };

  const nameTaken =
    isApiError(update.error, 409) &&
    update.error.code === ApiErrorCode.SERVICE_NAME_TAKEN;
  const teamGone =
    isApiError(update.error, 404) &&
    update.error.code === ApiErrorCode.TEAM_NOT_FOUND;
  const fields = fieldErrorsOf(update.error);

  return (
    <form
      ref={requiredRef}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
      <RequiredNote />
      {update.isError &&
        !nameTaken &&
        !teamGone &&
        Object.keys(fields).length === 0 && (
          <ErrorAlert error={update.error} />
        )}
      <Field
        label="Name"
        name="name"
        defaultValue={service.name}
        required
        maxLength={100}
        autoComplete="off"
        error={nameTaken ? SERVICE_NAME_TAKEN_MESSAGE : fields.name}
      />
      <Field
        label="Description"
        name="description"
        defaultValue={service.description ?? ""}
        optional
        maxLength={500}
        autoComplete="off"
        error={fields.description}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <CriticalitySelect
          value={criticality}
          onChange={setCriticality}
          error={fields.criticality}
        />
        {teams.isError ? (
          <ErrorAlert error={teams.error} />
        ) : !teams.data ? (
          <Spinner label="Loading teams…" />
        ) : (
          <Select
            label="Owner team"
            name="ownerTeamId"
            defaultValue={service.ownerTeam.id}
            error={teamGone ? OWNER_TEAM_GONE_MESSAGE : fields.ownerTeamId}
          >
            {teams.data.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <p className="text-xs text-fg-subtle">
        A new owner takes incidents declared from now on; open ones keep the
        team they have.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SubmitHint id={required.hintId} missing={required.missing} />
        <Button icon={X} variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button icon={Save}
          type="submit"
          disabled={update.isPending || !required.ready}
          aria-describedby={required.ready ? undefined : required.hintId}
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Retires the service, or returns it to use. Archiving keeps it — and every
 * incident recorded against it — and stops new incidents being declared
 * against it. It is the way to retire a service that has incidents, which
 * cannot be deleted.
 */
function ArchiveService({ service }: { service: ServiceResponse }) {
  const update = useUpdateService(service);
  const archived = Boolean(service.archivedAt);

  return (
    <section
      aria-labelledby="archive-service-title"
      className="-mx-5 mt-6 flex flex-col gap-2 border-t border-line bg-sunken px-5 py-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          <h3
            id="archive-service-title"
            className="text-sm font-semibold text-fg"
          >
            {archived ? "Unarchive service" : "Archive service"}
          </h3>
          <p className="text-sm text-fg-muted">
            {archived
              ? "It is archived. Unarchiving makes it available for new incidents again."
              : "Retire it: kept with its incidents, but no new incident can be declared against it. It can be unarchived."}
          </p>
        </div>
        <Button icon={archived ? RotateCcw : Archive}
          variant={archived ? "restore" : "destructive"}
          disabled={update.isPending}
          onClick={() => update.mutate({ archived: !archived })}
        >
          {update.isPending
            ? archived
              ? "Unarchiving…"
              : "Archiving…"
            : archived
              ? "Unarchive"
              : "Archive"}
        </Button>
      </div>
      {update.isError && <ErrorAlert error={update.error} />}
    </section>
  );
}

const hasIncidentsError = (error: unknown) =>
  isApiError(error, 409) && error.code === ApiErrorCode.SERVICE_HAS_INCIDENTS;

/** Deleting the service, set apart at the dialog's foot. */
function DeleteService({
  service,
  confirming,
  setConfirming,
  onDeleted,
}: {
  service: ServiceResponse;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  onDeleted: () => void;
}) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  // Gone either way — deleted now, or already (404): close on the list,
  // refreshed, which no longer has it.
  const gone = () => {
    onDeleted();
    void queryClient.invalidateQueries({
      queryKey: queryKeys.services(organization.id),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.teams(organization.id),
      exact: true,
    });
  };
  const remove = useMutation({
    mutationFn: () => deleteService(organization.id, service.id),
    onSuccess: gone,
    onError: (error) => {
      if (isApiError(error, 404)) gone();
    },
  });

  let body;

  if (hasIncidentsError(remove.error)) {
    body = (
      <Alert tone="info" title="This service has incidents">
        <p>
          Incidents have been recorded against {service.name}, and they keep it
          as their history, so it cannot be deleted. Archive it instead.
        </p>
      </Alert>
    );
  } else if (confirming) {
    body = (
      <Alert tone="warning" title={`Delete ${service.name}?`}>
        <p>
          It will no longer appear in Services or on {service.ownerTeam.name}
          &rsquo;s page. This cannot be undone.
        </p>
        <div className="flex gap-2 pt-2">
          <Button icon={Trash2}
            variant="danger"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Deleting…" : "Delete service"}
          </Button>
          <Button icon={X}
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
        <Button icon={Trash2} variant="destructive" onClick={() => setConfirming(true)}>
          Delete service…
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="delete-service-title"
      className="-mx-5 -mb-5 flex flex-col gap-3 border-t border-line bg-sunken px-5 pt-4 pb-5"
    >
      <div className="flex flex-col gap-0.5">
        <h3
          id="delete-service-title"
          className="text-sm font-semibold text-danger-text"
        >
          Delete service
        </h3>
        <p className="text-sm text-fg-muted">
          Removes it for good. A service with incidents cannot be deleted;
          archive it instead.
        </p>
      </div>
      {remove.isError &&
        !isApiError(remove.error, 404) &&
        !hasIncidentsError(remove.error) && <ErrorAlert error={remove.error} />}
      {body}
    </section>
  );
}

/**
 * Editing a service from the Services list: its details and owner, then —
 * apart, at the foot — archiving and deleting it. The service is read from
 * the list as it stands, so a change made meanwhile shows; if it goes, so
 * does the dialog.
 */
export function EditServiceDialog({
  service,
  onClose,
}: {
  service: ServiceResponse;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <FormDialog
      title="Edit service"
      description={`${service.name}. Its address stays the same.`}
      onClose={onClose}
      // A delete half-confirmed is not lost to a stray click.
      closeOnBackdrop={!confirming}
    >
      <DetailsForm service={service} onSaved={onClose} onCancel={onClose} />
      <ArchiveService service={service} />
      <DeleteService
        service={service}
        confirming={confirming}
        setConfirming={setConfirming}
        onDeleted={onClose}
      />
    </FormDialog>
  );
}
