"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, MouseEvent } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { teamHref, teamsHref, useTeams } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyNote, EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader, Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { linkClasses, quietLinkClasses } from "@/components/ui/link";
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
import { CriticalityMark } from "./criticality-mark";
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
 * Creates a service. The new service is put into the cached list, so the
 * list behind the dialog shows it without waiting for a refetch. The owning
 * team's service count changes, so teams stale too.
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

function CreateServiceForm({ onClose }: { onClose: () => void }) {
  const organization = useOrganization();
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
      { onSuccess: onClose },
    );
  };

  const nameTaken =
    isApiError(create.error, 409) &&
    create.error.code === ApiErrorCode.SERVICE_NAME_TAKEN;
  const ownerGone =
    isApiError(create.error, 404) &&
    create.error.code === ApiErrorCode.TEAM_NOT_FOUND;
  const fields = fieldErrorsOf(create.error);

  if (teams.isError) return <ErrorAlert error={teams.error} />;
  if (!teams.data) return <Spinner label="Loading teams…" />;

  if (teams.data.length === 0) {
    return (
      <EmptyState
        title="Create a team first"
        action={
          <div className="flex items-center gap-4">
            {canManageTeams && (
              <Link
                href={teamsHref(organization.slug)}
                className={`text-sm ${linkClasses}`}
              >
                Go to Teams
              </Link>
            )}
            <Button variant="secondary" size="sm" onClick={onClose}>
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
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
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
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle pt-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create service"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Creating a service, in a dialog over the list. Creating closes it, and the
 * new service is already in the list beneath.
 *
 * A native <dialog> opened with showModal(), as the manage-incident drawer
 * and the date-range dialog are: the page is inert behind it and focus stays
 * inside. Escape, a click on the backdrop, Close, and Cancel dismiss it, and
 * focus returns to what opened it. Mounted only while open, so each opening
 * starts from an empty form.
 */
function CreateServiceDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;

    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");

    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  // A click on the backdrop lands on the dialog element itself.
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={onClick}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-lg border border-line bg-surface p-0 text-fg shadow-overlay backdrop:bg-scrim/40"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-[0.9375rem] font-semibold text-fg">
            New service
          </h2>
          <p id={descriptionId} className="mt-0.5 text-sm text-fg-muted">
            A system this organization runs, owned by one of its teams.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <X aria-hidden="true" className="size-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className="px-5 py-5">
        <CreateServiceForm onClose={onClose} />
      </div>
    </dialog>
  );
}

/**
 * `onCreate` is absent for those who may not manage services; `canManage`
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

  const inUse = services.data.filter((service) => !service.archivedAt);
  const archived = services.data.filter((service) => service.archivedAt);

  return (
    <>
      {inUse.length > 0 ? (
        <ServiceTable label="Services" services={inUse} />
      ) : (
        <EmptyNote title="Every service is archived">
          Archived services are listed below, kept for their incidents.
        </EmptyNote>
      )}
      {archived.length > 0 && (
        <Section
          id="archived-services"
          title="Archived"
          meta={archived.length}
          description="Retired services, kept because incidents were recorded against them or for reference. No new incident can be declared against them."
        >
          <ServiceTable label="Archived services" services={archived} />
        </Section>
      )}
    </>
  );
}

function ServiceTable({
  label,
  services,
}: {
  label: string;
  services: ServiceResponse[];
}) {
  const organization = useOrganization();

  return (
    <Table label={label}>
      <THead>
        <TR>
          <TH>Name</TH>
          <TH className="hidden sm:table-cell">Owner team</TH>
          <TH>Criticality</TH>
        </TR>
      </THead>
      <TBody>
        {services.map((service) => (
          <TR key={service.id}>
            <TD>
              <Link
                href={serviceHref(organization.slug, service.slug)}
                className={`font-medium text-fg ${quietLinkClasses}`}
              >
                {service.name}
              </Link>
              {/* What it is, as the name's second line, not a column of its own. */}
              {service.description && (
                <span className="block max-w-xl truncate text-sm text-fg-subtle">
                  {service.description}
                </span>
              )}
              {/* On narrow screens the owner folds under the name. */}
              <span className="block truncate text-xs text-fg-muted sm:hidden">
                {service.ownerTeam.name}
              </span>
            </TD>
            <TD className="hidden sm:table-cell">
              <Link
                href={teamHref(organization.slug, service.ownerTeam.id)}
                className={`text-fg-muted ${quietLinkClasses}`}
              >
                {service.ownerTeam.name}
              </Link>
            </TD>
            <TD>
              <CriticalityMark criticality={service.criticality} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/**
 * The Services page: every service, its owner and criticality, and — for
 * those the API says may manage services — a dialog to create one, opened
 * from the header. A dialog rather than a `/services/new` route, which would
 * shadow a service whose derived slug is `new`.
 */
export function ServicesView() {
  const organization = useOrganization();
  const services = useServices(organization.id);
  const canManage = useCan(Permission.SERVICES_MANAGE);
  const [creating, setCreating] = useState(false);
  const openCreate = () => setCreating(true);

  return (
    <>
      <PageHeader
        width="list"
        title="Services"
        meta={services.data?.length}
        description="The systems this organization runs, who owns each, and how much depends on it."
        actions={
          canManage && <Button onClick={openCreate}>New service</Button>
        }
      />
      <PageBody width="list">
        <ServiceList
          canManage={canManage}
          onCreate={canManage ? openCreate : undefined}
        />
      </PageBody>
      {canManage && creating && (
        <CreateServiceDialog onClose={() => setCreating(false)} />
      )}
    </>
  );
}
