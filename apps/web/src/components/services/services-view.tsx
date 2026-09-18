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
import { teamHref, teamsHref, useTeams } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader, Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type {
  CreateServiceRequest,
  ServiceCriticality,
  ServiceResponse,
} from "@/lib/api/contracts";
import { createService } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import {
  CRITICALITY_LEVELS,
  criticalityOf,
  DEFAULT_CRITICALITY,
} from "./criticality";
import { serviceHref, useServices } from "./service-scope";

export const SERVICE_NAME_TAKEN_MESSAGE =
  "A service with this name, or a very similar one, already exists.";

export const OWNER_TEAM_GONE_MESSAGE =
  "That team no longer exists. The list of teams has been refreshed.";

/**
 * The criticality picker, with the chosen level's definition beneath it so
 * the words mean the same thing to everyone choosing them.
 */
export function CriticalitySelect({
  value,
  onChange,
  error,
}: {
  value: ServiceCriticality;
  onChange: (value: ServiceCriticality) => void;
  error?: string;
}) {
  return (
    <Select
      label="Criticality"
      name="criticality"
      value={value}
      onChange={(event) => onChange(event.target.value as ServiceCriticality)}
      hint={criticalityOf(value).definition}
      error={error}
    >
      {CRITICALITY_LEVELS.map((level) => (
        <option key={level.value} value={level.value}>
          {level.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * Creates a service. The new service is put into the cached list before
 * navigating to it, so its page resolves the slug without waiting for a
 * refetch. The owning team's service count changes, so teams stale too.
 */
const useCreateService = (organizationId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateServiceRequest) =>
      createService(organizationId, body),
    onSuccess: (created) => {
      queryClient.setQueryData<ServiceResponse[]>(
        queryKeys.services(organizationId),
        (current) => (current ? [...current, created] : current),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.services(organizationId),
        exact: true,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teams(organizationId),
        exact: true,
      });
    },
    onError: (error) => {
      // The chosen owner is gone: refresh the teams the form offers.
      if (isApiError(error, 404)) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.teams(organizationId),
          exact: true,
        });
      }
    },
  });
};

function CreateServiceForm({ onCancel }: { onCancel: () => void }) {
  const organization = useOrganization();
  const router = useRouter();
  const teams = useTeams(organization.id);
  const canManageTeams = useCan(Permission.TEAMS_MANAGE);
  const create = useCreateService(organization.id);
  const [criticality, setCriticality] =
    useState<ServiceCriticality>(DEFAULT_CRITICALITY);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    create.mutate(
      {
        name: String(data.get("name") ?? ""),
        description: String(data.get("description") ?? ""),
        ownerTeamId: String(data.get("ownerTeamId") ?? ""),
        criticality,
      },
      {
        onSuccess: (created) =>
          router.push(serviceHref(organization.slug, created.slug)),
      },
    );
  };

  const nameTaken =
    isApiError(create.error, 409) &&
    create.error.code === ApiErrorCode.SERVICE_NAME_TAKEN;
  const ownerGone =
    isApiError(create.error, 404) &&
    create.error.code === ApiErrorCode.TEAM_NOT_FOUND;
  const fields = fieldErrorsOf(create.error);

  let body;

  if (teams.isError) {
    body = <ErrorAlert error={teams.error} />;
  } else if (!teams.data) {
    body = <Spinner label="Loading teams…" />;
  } else if (teams.data.length === 0) {
    body = (
      <EmptyState
        title="Create a team first"
        action={
          <div className="flex items-center gap-4">
            {canManageTeams && (
              <Link
                href={teamsHref(organization.slug)}
                className="text-sm font-medium text-accent-text underline-offset-2 hover:underline"
              >
                Go to Teams
              </Link>
            )}
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        }
      >
        <p>
          Every service is owned by a team, and this organization has none yet.
          {canManageTeams ? "" : " An owner or admin can create one."}
        </p>
      </EmptyState>
    );
  } else {
    body = (
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex max-w-xl flex-col gap-4"
      >
        {create.isError &&
          !nameTaken &&
          !ownerGone &&
          Object.keys(fields).length === 0 && (
            <ErrorAlert error={create.error} />
          )}
        <Field
          label="Name"
          name="name"
          required
          maxLength={100}
          autoComplete="off"
          error={nameTaken ? SERVICE_NAME_TAKEN_MESSAGE : fields.name}
        />
        <Field
          label="Description"
          name="description"
          optional
          maxLength={500}
          autoComplete="off"
          hint="What the service does."
          error={fields.description}
        />
        <Select
          label="Owner team"
          name="ownerTeamId"
          hint="The team responsible for this service."
          error={ownerGone ? OWNER_TEAM_GONE_MESSAGE : fields.ownerTeamId}
        >
          {teams.data.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
        <CriticalitySelect
          value={criticality}
          onChange={setCriticality}
          error={fields.criticality}
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create service"}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <Section
      id="new-service"
      title="New service"
      description="A system this organization runs, owned by one of its teams."
    >
      {body}
    </Section>
  );
}

/**
 * `onCreate` is absent while the create form is already open; `canManage`
 * says whether to tell the reader someone else must add one.
 */
function ServiceList({
  canManage,
  onCreate,
}: {
  canManage: boolean;
  onCreate?: () => void;
}) {
  const organization = useOrganization();
  const services = useServices(organization.id);

  if (services.isError) return <ErrorAlert error={services.error} />;
  if (!services.data) return <Spinner label="Loading services…" />;

  if (services.data.length === 0) {
    return (
      <EmptyState
        title="No services yet"
        action={
          onCreate && (
            <Button variant="secondary" onClick={onCreate}>
              New service
            </Button>
          )
        }
      >
        <p>
          Services are the systems this organization runs, each owned by a
          team.
          {canManage ? "" : " An owner or admin can add one."}
        </p>
      </EmptyState>
    );
  }

  return (
    <Table label="Services" density="compact">
      <THead>
        <TR>
          <TH>Name</TH>
          <TH>Owner team</TH>
          <TH>Criticality</TH>
          <TH className="hidden md:table-cell">Description</TH>
        </TR>
      </THead>
      <TBody>
        {services.data.map((service) => (
          <TR key={service.id}>
            <TD>
              <Link
                href={serviceHref(organization.slug, service.slug)}
                className="font-medium text-fg underline-offset-2 hover:text-accent-text hover:underline"
              >
                {service.name}
              </Link>
            </TD>
            <TD>
              <Link
                href={teamHref(organization.slug, service.ownerTeam.slug)}
                className="text-fg-muted underline-offset-2 hover:text-accent-text hover:underline"
              >
                {service.ownerTeam.name}
              </Link>
            </TD>
            <TD>{criticalityOf(service.criticality).label}</TD>
            <TD kind="muted" className="hidden max-w-md truncate md:table-cell">
              {service.description}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/**
 * The Services page: every service, its owner and criticality, and — for
 * those the API says may manage services — a form to create one, opened from
 * the header. Inline rather than a `/services/new` route, which would shadow a
 * service whose derived slug is `new`.
 */
export function ServicesView() {
  const organization = useOrganization();
  const services = useServices(organization.id);
  const canManage = useCan(Permission.SERVICES_MANAGE);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow={organization.name}
        title="Services"
        meta={services.data?.length}
        description="The systems this organization runs, who owns each, and how much depends on it."
        actions={
          canManage &&
          !creating && (
            <Button onClick={() => setCreating(true)}>New service</Button>
          )
        }
      />
      <PageBody>
        {canManage && creating && (
          <CreateServiceForm onCancel={() => setCreating(false)} />
        )}
        <ServiceList
          canManage={canManage}
          onCreate={
            canManage && !creating ? () => setCreating(true) : undefined
          }
        />
      </PageBody>
    </>
  );
}
