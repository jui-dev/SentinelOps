"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import type { FormEvent } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { useIncidentList } from "@/components/incidents/incident-queries";
import { teamHref, teamsHref, useTeams } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import {
  FilterBar,
  FilterDivider,
  FilterGroup,
  FilterOption,
  FilterSearch,
} from "@/components/ui/filter-bar";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { FormExample } from "@/components/ui/form-example";
import { EmptyState, NoMatches } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { ListLoading, Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { linkClasses } from "@/components/ui/link";
import {
  RequiredNote,
  SubmitHint,
  useRequiredFields,
} from "@/components/ui/required";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type {
  CreateServiceRequest,
  IncidentSeverity,
  ServiceCriticality,
  ServiceResponse,
} from "@/lib/api/contracts";
import { createService } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { CRITICALITY_LEVELS, DEFAULT_CRITICALITY } from "./criticality";
import { CriticalityMark } from "./criticality-mark";
import { EditServiceDialog } from "./edit-service-dialog";
import { ServicePeek } from "./service-peek";
import {
  CriticalitySelect,
  OWNER_TEAM_GONE_MESSAGE,
  SERVICE_NAME_TAKEN_MESSAGE,
} from "./service-form-parts";
import { serviceHref, useServices } from "./service-scope";
import { ButtonLink } from "@/components/ui/button-link";

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

const SERVICE_EXAMPLE = [
  { label: "Name", value: "Payment API" },
  {
    label: "Description",
    value: "Takes card payments at checkout and sends them to the bank.",
  },
  { label: "Owner team", value: "Payments", half: true },
  { label: "Criticality", value: "Critical", half: true },
];

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
  const { attach: requiredRef, ...required } = useRequiredFields();

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
            <Button icon={X} variant="secondary" size="sm" onClick={onClose}>
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
    <form
      ref={requiredRef}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
      <FormExample fields={SERVICE_EXAMPLE} />
      <RequiredNote />
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
      <DialogActions>
        <SubmitHint id={required.hintId} missing={required.missing} />
        <Button icon={X} variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button icon={Plus}
          type="submit"
          disabled={create.isPending || !required.ready}
          aria-describedby={required.ready ? undefined : required.hintId}
        >
          {create.isPending ? "Creating…" : "Create service"}
        </Button>
      </DialogActions>
    </form>
  );
}

// ── Status ─────────────────────────────────────────────────────────────────

/** A service's active incidents: how many, and the most severe of them. */
interface ServiceStatus {
  count: number;
  worst: IncidentSeverity;
}

/**
 * Every service's active incidents, from the one active-incident list the
 * Incidents page and the rail already read — grouped here, not asked for
 * per service. Most severe first is the list's own order, so the first an
 * incident seen for a service is its worst. Only with `incidents:read`.
 */
const useServiceStatuses = (enabled: boolean) => {
  const organization = useOrganization();
  const active = useIncidentList(
    organization.id,
    "active",
    undefined,
    {},
    enabled,
  );
  const items = active.data?.pages[0]?.items;

  if (!items) return undefined;

  const statuses = new Map<string, ServiceStatus>();

  for (const incident of items) {
    const current = statuses.get(incident.service.id);

    statuses.set(
      incident.service.id,
      current
        ? { ...current, count: current.count + 1 }
        : { count: 1, worst: incident.severity },
    );
  }

  return statuses;
};

const STATUS_TONES: Record<IncidentSeverity, string> = {
  SEV1: "border-danger-line bg-danger-subtle text-danger-text",
  SEV2: "border-danger-line bg-danger-subtle text-danger-text",
  SEV3: "border-warning-line bg-warning-subtle text-warning-text",
  SEV4: "border-info-line bg-info-subtle text-info-text",
};

const BADGE =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-semibold";

/** Whether anything is wrong with a service now: what has been declared. */
function StatusBadge({ status }: { status: ServiceStatus | undefined }) {
  if (!status) {
    return (
      <span
        className={cx(
          BADGE,
          "border-success-line bg-success-subtle text-success-text",
        )}
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
        No active incidents
      </span>
    );
  }

  return (
    <span className={cx(BADGE, STATUS_TONES[status.worst])}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {status.count} active · {status.worst}
    </span>
  );
}

// ── Filters ────────────────────────────────────────────────────────────────

type FilterId =
  | "all"
  | ServiceCriticality
  | "active-incidents"
  | "archived";

const FILTERS: {
  id: FilterId;
  label: string;
  /** A count that wants attention when above nought. */
  attention?: boolean;
}[] = [
  { id: "all", label: "All" },
  ...CRITICALITY_LEVELS.map(({ value, label }) => ({ id: value, label })),
  { id: "active-incidents", label: "With active incidents", attention: true },
  { id: "archived", label: "Archived" },
];

/**
 * Whether a service is shown under a filter. Every filter but Archived is
 * of the services in use: an archived service has no active incidents and
 * is looked for on purpose.
 */
const matches = (
  filter: FilterId,
  service: ServiceResponse,
  statuses: Map<string, ServiceStatus> | undefined,
) => {
  if (filter === "archived") return service.archivedAt !== null;
  if (service.archivedAt !== null) return false;
  if (filter === "all") return true;
  if (filter === "active-incidents") return statuses?.has(service.id) ?? false;

  return service.criticality === filter;
};

function Toolbar({
  services,
  statuses,
  withStatus,
  query,
  onQuery,
  filter,
  onFilter,
}: {
  services: ServiceResponse[];
  statuses: Map<string, ServiceStatus> | undefined;
  withStatus: boolean;
  query: string;
  onQuery: (value: string) => void;
  filter: FilterId;
  onFilter: (value: FilterId) => void;
}) {
  const offered = FILTERS.filter(
    ({ id }) => withStatus || id !== "active-incidents",
  );
  const option = (each: (typeof FILTERS)[number]) => (
    <FilterOption
      key={each.id}
      pressed={each.id === filter}
      onClick={() => onFilter(each.id)}
      count={services.filter((service) => matches(each.id, service, statuses)).length}
      attention={each.attention}
    >
      {each.label}
    </FilterOption>
  );
  const shows = new Set<FilterId>(["active-incidents", "archived"]);

  return (
    <FilterBar label="Find services">
      <FilterSearch
        label="Search services"
        value={query}
        onChange={onQuery}
        placeholder="Name or team"
      />
      <FilterDivider />
      <FilterGroup label="Criticality">
        {offered.filter(({ id }) => !shows.has(id)).map(option)}
      </FilterGroup>
      <FilterGroup label="Show">
        {offered.filter(({ id }) => shows.has(id)).map(option)}
      </FilterGroup>
    </FilterBar>
  );
}

// ── The list ───────────────────────────────────────────────────────────────

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
  const withStatus = useCan(Permission.INCIDENTS_READ);
  const statuses = useServiceStatuses(withStatus);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  // By id, read from the list as it stands: a service deleted meanwhile
  // closes its dialog.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Any number open at once, so services can be compared side by side.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (serviceId: string) =>
    setExpanded((current) => {
      const next = new Set(current);

      if (!next.delete(serviceId)) next.add(serviceId);

      return next;
    });

  if (services.isError) return <ErrorAlert error={services.error} />;
  if (!services.data) return <ListLoading label="Loading services…" />;

  if (services.data.length === 0) {
    return (
      <EmptyState
        title="No services yet"
        action={
          onCreate && (
            <Button icon={Plus} variant="add" onClick={onCreate}>
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

  const q = query.trim().toLowerCase();
  const shown = services.data.filter(
    (service) =>
      matches(filter, service, statuses) &&
      (q === "" ||
        service.name.toLowerCase().includes(q) ||
        service.ownerTeam.name.toLowerCase().includes(q)),
  );
  const editing = services.data.find(({ id }) => id === editingId);

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        services={services.data}
        statuses={statuses}
        withStatus={withStatus}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
      />
      <Table label={filter === "archived" ? "Archived services" : "Services"}
          columns={[
            "main",
            { kind: "group", from: "sm" },
            "label",
            ...(withStatus ? [{ kind: "status", from: "md" } as const] : []),
            canManage ? "actions2" : "actions",
          ]}
        >
        <THead>
          <TR>
            <TH>Service</TH>
            <TH className="hidden sm:table-cell">Owner team</TH>
            <TH>Criticality</TH>
            {withStatus && <TH className="hidden md:table-cell">Status</TH>}
            <TH align="end">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {shown.length === 0 ? (
            <TR>
              <TD colSpan={withStatus ? 5 : 4}>
                <NoMatches
                  title={
                    filter === "archived" && q === ""
                      ? "No service is archived"
                      : "No services match"
                  }
                  action={
                    <Button
                      icon={X}
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setQuery("");
                        setFilter("all");
                      }}
                    >
                      Show every service
                    </Button>
                  }
                >
                  {filter === "archived" && q === ""
                    ? "Archived services keep their incidents, and appear here."
                    : "No service fits this search and filter together."}
                </NoMatches>
              </TD>
            </TR>
          ) : (
            shown.map((service) => {
              const open = expanded.has(service.id);
              const peekId = `service-peek-${service.id}`;

              return (
              <Fragment key={service.id}>
              <TR
                // A click anywhere on the row opens it, as the chevron does —
                // but not one meant for a link or an action.
                onClick={(event) => {
                  if ((event.target as Element).closest("a, button")) return;
                  toggle(service.id);
                }}
                className="cursor-pointer"
              >
                <TD>
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={open ? peekId : undefined}
                      aria-label={`${open ? "Hide" : "Show"} incidents and responders of ${service.name}`}
                      onClick={() => toggle(service.id)}
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
                  <span className="font-medium text-fg">{service.name}</span>
                  {service.archivedAt && (
                    <span className="ml-2 rounded-sm border border-line px-1.5 text-2xs text-fg-subtle">
                      Archived
                    </span>
                  )}
                  {/* What it is, as the name's second line. */}
                  {service.description && (
                    <span className="block max-w-xl truncate text-sm text-fg-subtle">
                      {service.description}
                    </span>
                  )}
                  {/* On narrow screens the owner folds under the name. */}
                  <span className="block truncate text-xs text-fg-muted sm:hidden">
                    {service.ownerTeam.name}
                  </span>
                    </div>
                  </div>
                </TD>
                <TD className="hidden sm:table-cell">
                  <Link
                    href={teamHref(organization.slug, service.ownerTeam.slug)}
                    className="rounded-full border border-line bg-hover px-2.5 py-px text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {service.ownerTeam.name}
                  </Link>
                </TD>
                <TD>
                  <CriticalityMark criticality={service.criticality} />
                </TD>
                {withStatus && (
                  <TD className="hidden md:table-cell">
                    {service.archivedAt ? (
                      <span className="text-sm text-fg-subtle">Retired</span>
                    ) : statuses ? (
                      <StatusBadge status={statuses.get(service.id)} />
                    ) : (
                      <span className="text-sm text-fg-subtle">…</span>
                    )}
                  </TD>
                )}
                <TD kind="actions">
                  <div className="flex items-center justify-end gap-2">
                    <ButtonLink
                      href={serviceHref(organization.slug, service.slug)}
                      aria-label={`View ${service.name}`}
                      variant="view"
                      size="sm"
                      icon={Eye}
                    >
                      View
                    </ButtonLink>
                    {canManage && (
                      <Button
                        variant="edit"
                        size="sm"
                        icon={Pencil}
                        aria-label={`Edit ${service.name}`}
                        onClick={() => setEditingId(service.id)}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
              {open && (
                // A plain row, outside the table's hover: the row above, opened.
                <tr id={peekId}>
                  <td
                    colSpan={withStatus ? 5 : 4}
                    className="border-b border-line-subtle bg-sunken px-3 py-3 sm:px-4"
                  >
                    <ServicePeek service={service} />
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })
          )}
        </TBody>
      </Table>
      {canManage && editing && (
        <EditServiceDialog
          key={editing.id}
          service={editing}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

/**
 * The Services page: every service, who owns it, how much depends on it,
 * and whether anything is wrong with it now — found by name or team and
 * narrowed by criticality, by what has active incidents, or to the archived.
 * Those who may manage services create one from the header and edit each
 * from its row. A dialog rather than a `/services/new` route, which would
 * shadow a service whose derived slug is `new`.
 */
export function ServicesView() {
  const organization = useOrganization();
  const services = useServices(organization.id);
  const canManage = useCan(Permission.SERVICES_MANAGE);
  const [creating, setCreating] = useState(false);
  const openCreate = () => setCreating(true);
  const inUse = services.data?.filter((service) => !service.archivedAt);

  return (
    <>
      <PageHeader
        width="full"
        title="Services"
        meta={inUse?.length}
        description="The systems this organization runs, who owns each, and whether anything is wrong with it now."
        actions={
          canManage && <Button icon={Plus} onClick={openCreate}>New service</Button>
        }
      />
      <PageBody width="full">
        <ServiceList
          canManage={canManage}
          onCreate={canManage ? openCreate : undefined}
        />
      </PageBody>
      {canManage && creating && (
        <FormDialog
          title="New service"
          description="A system this organization runs, owned by one of its teams."
          onClose={() => setCreating(false)}
        >
          <CreateServiceForm onClose={() => setCreating(false)} />
        </FormDialog>
      )}
    </>
  );
}
