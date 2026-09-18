"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { useTeams } from "@/components/teams/team-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { SettingRow } from "@/components/ui/setting-row";
import { Spinner } from "@/components/ui/spinner";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type {
  ServiceCriticality,
  ServiceResponse,
  UpdateServiceRequest,
} from "@/lib/api/contracts";
import { deleteService, updateService } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { servicesHref, useService } from "./service-scope";
import {
  CriticalitySelect,
  OWNER_TEAM_GONE_MESSAGE,
  SERVICE_NAME_TAKEN_MESSAGE,
} from "./services-view";

/**
 * Changes the current service. The slug never changes, so the page stays
 * where it is: the updated service replaces the cached one. Teams stale too,
 * because moving a service changes two teams' service counts. A 404 means the
 * page was out of date, and refreshing the lists shows why.
 */
const useUpdateService = () => {
  const organization = useOrganization();
  const service = useService();
  const queryClient = useQueryClient();

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
    },
    onError: (error) => {
      if (isApiError(error, 404)) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.services(organization.id),
          exact: true,
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.teams(organization.id),
          exact: true,
        });
      }
    },
  });
};

function EditServiceForm() {
  const service = useService();
  const update = useUpdateService();
  const [saved, setSaved] = useState(false);
  const [criticality, setCriticality] = useState<ServiceCriticality>(
    service.criticality,
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setSaved(false);
    update.mutate(
      {
        name: String(data.get("name") ?? ""),
        description: String(data.get("description") ?? ""),
        criticality,
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  const nameTaken =
    isApiError(update.error, 409) &&
    update.error.code === ApiErrorCode.SERVICE_NAME_TAKEN;
  const fields = fieldErrorsOf(update.error);

  return (
    <SettingRow
      title="Details"
      description={
        <p>
          The name, what the service does, and how much the organization
          depends on it.
        </p>
      }
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex max-w-md flex-col gap-4"
      >
        {update.isError && !nameTaken && Object.keys(fields).length === 0 && (
          <ErrorAlert error={update.error} />
        )}
        {saved && <Alert tone="success">Service updated.</Alert>}
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
        <CriticalitySelect
          value={criticality}
          onChange={setCriticality}
          error={fields.criticality}
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

function OwnershipForm() {
  const organization = useOrganization();
  const service = useService();
  const teams = useTeams(organization.id);
  const update = useUpdateService();
  const [moved, setMoved] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ownerTeamId = String(
      new FormData(event.currentTarget).get("ownerTeamId") ?? "",
    );

    setMoved(false);
    update.mutate({ ownerTeamId }, { onSuccess: () => setMoved(true) });
  };

  const teamGone =
    isApiError(update.error, 404) &&
    update.error.code === ApiErrorCode.TEAM_NOT_FOUND;

  return (
    <SettingRow
      title="Owner team"
      description={
        <p>
          The team responsible for this service. A team cannot be deleted
          while it owns services, so move them first.
        </p>
      }
    >
      {teams.isError ? (
        <ErrorAlert error={teams.error} />
      ) : !teams.data ? (
        <Spinner label="Loading teams…" />
      ) : (
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex max-w-md flex-col gap-4"
        >
          {update.isError && !teamGone && <ErrorAlert error={update.error} />}
          {moved && (
            <Alert tone="success">
              Now owned by {service.ownerTeam.name}.
            </Alert>
          )}
          <Select
            label="Owner team"
            name="ownerTeamId"
            defaultValue={service.ownerTeam.id}
            error={teamGone ? OWNER_TEAM_GONE_MESSAGE : undefined}
          >
            {teams.data.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
          <div>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Change owner"}
            </Button>
          </div>
        </form>
      )}
    </SettingRow>
  );
}

function DeleteService() {
  const organization = useOrganization();
  const service = useService();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  // Gone either way — deleted now, or already (404) — so leave for the list.
  // Leave first: refreshing the list while still here would show this
  // service's page as not found on the way out.
  const leave = () => {
    router.push(servicesHref(organization.slug));
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
    onSuccess: leave,
    onError: (error) => {
      if (isApiError(error, 404)) leave();
    },
  });

  return (
    <SettingRow
      title="Delete service"
      description={
        <p>
          Removes the service from this organization. Its owner team is not
          affected. This cannot be undone.
        </p>
      }
    >
      {remove.isError && !isApiError(remove.error, 404) && (
        <ErrorAlert error={remove.error} className="mb-4" />
      )}
      {confirming ? (
        <Alert tone="warning" title={`Delete ${service.name}?`}>
          <p>
            It will no longer appear in Services or on{" "}
            {service.ownerTeam.name}’s page.
          </p>
          <div className="flex gap-2 pt-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Deleting…" : "Delete service"}
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
          Delete service…
        </Button>
      )}
    </SettingRow>
  );
}

/** A service's settings: its details, its owner, and deleting it. */
export function ServiceSettings() {
  const organization = useOrganization();
  const service = useService();
  const canManage = useCan(Permission.SERVICES_MANAGE);

  return (
    <>
      <PageHeader
        eyebrow={`${organization.name} · ${service.name}`}
        title="Service settings"
      />
      <PageBody width="form">
        {canManage ? (
          <>
            <EditServiceForm />
            <OwnershipForm />
            <DeleteService />
          </>
        ) : (
          <Alert tone="info">
            You do not have permission to change this service. An owner or
            admin can change it.
          </Alert>
        )}
      </PageBody>
    </>
  );
}
