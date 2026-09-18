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
import { criticalityOf } from "@/components/services/criticality";
import {
  servicesHref,
  useServices,
} from "@/components/services/service-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, TextArea } from "@/components/ui/field";
import { PageBody, PageHeader, Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Duration, IsoDate } from "@/components/ui/timestamp";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type {
  CreateIncidentRequest,
  IncidentResponse,
  IncidentSeverity,
  IncidentState,
} from "@/lib/api/contracts";
import { createIncident } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import {
  incidentHref,
  storeIncident,
  useIncidentList,
} from "./incident-queries";
import {
  incidentKey,
  SEVERITY_LEVELS,
  SeverityMark,
  severityOf,
  statusOf,
} from "./severity";

export const SERVICE_UNAVAILABLE_MESSAGE =
  "That service is no longer available for new incidents. The list of services has been refreshed.";

/**
 * The severity picker. Nothing is preselected — choosing a severity is a
 * judgement the declarer makes, not a default they accept — and the chosen
 * level's definition is shown beneath it.
 */
export function SeveritySelect({
  value,
  onChange,
  error,
  placeholder,
}: {
  value: IncidentSeverity | "";
  onChange: (value: IncidentSeverity) => void;
  error?: string;
  /** Offered while nothing is chosen, on a declaration. */
  placeholder?: string;
}) {
  return (
    <Select
      label="Severity"
      name="severity"
      value={value}
      onChange={(event) => onChange(event.target.value as IncidentSeverity)}
      hint={value ? severityOf(value).definition : undefined}
      error={error}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {SEVERITY_LEVELS.map((level) => (
        <option key={level.value} value={level.value}>
          {level.value} · {level.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * Declares an incident, then opens it. A refusal naming the service — gone,
 * or archived meanwhile — refreshes the services the form offers.
 */
const useDeclareIncident = (organizationId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateIncidentRequest) =>
      createIncident(organizationId, body),
    onSuccess: (created) => storeIncident(queryClient, organizationId, created),
    onError: (error) => {
      if (
        isApiError(error, 404) ||
        (isApiError(error, 409) &&
          error.code === ApiErrorCode.SERVICE_ARCHIVED)
      ) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.services(organizationId),
          exact: true,
        });
      }
    },
  });
};

function DeclareIncidentForm({ onCancel }: { onCancel: () => void }) {
  const organization = useOrganization();
  const router = useRouter();
  const services = useServices(organization.id);
  const canManageServices = useCan(Permission.SERVICES_MANAGE);
  const declare = useDeclareIncident(organization.id);
  const [serviceId, setServiceId] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity | "">("");

  const available = services.data?.filter((service) => !service.archivedAt);
  const chosen = available?.find((service) => service.id === serviceId);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    declare.mutate(
      {
        title: String(data.get("title") ?? ""),
        summary: String(data.get("summary") ?? ""),
        serviceId,
        severity: severity as IncidentSeverity,
      },
      {
        onSuccess: (created) =>
          router.push(incidentHref(organization.slug, created.number)),
      },
    );
  };

  const serviceUnavailable =
    (isApiError(declare.error, 404) &&
      declare.error.code === ApiErrorCode.SERVICE_NOT_FOUND) ||
    (isApiError(declare.error, 409) &&
      declare.error.code === ApiErrorCode.SERVICE_ARCHIVED);
  const fields = fieldErrorsOf(declare.error);

  let body;

  if (services.isError) {
    body = <ErrorAlert error={services.error} />;
  } else if (!available) {
    body = <Spinner label="Loading services…" />;
  } else if (available.length === 0) {
    body = (
      <EmptyState
        title="Add a service first"
        action={
          <div className="flex items-center gap-4">
            {canManageServices && (
              <Link
                href={servicesHref(organization.slug)}
                className="text-sm font-medium text-accent-text underline-offset-2 hover:underline"
              >
                Go to Services
              </Link>
            )}
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        }
      >
        <p>
          Every incident affects a service, and this organization has none in
          use.
          {canManageServices ? "" : " An owner or admin can add one."}
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
        {declare.isError &&
          !serviceUnavailable &&
          Object.keys(fields).length === 0 && (
            <ErrorAlert error={declare.error} />
          )}
        <Field
          label="Title"
          name="title"
          required
          maxLength={200}
          autoComplete="off"
          hint="What is happening, in a few words."
          error={fields.title}
        />
        <div className="flex flex-col gap-1.5">
          <Select
            label="Affected service"
            name="serviceId"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
            error={
              serviceUnavailable
                ? SERVICE_UNAVAILABLE_MESSAGE
                : fields.serviceId
            }
          >
            <option value="" disabled>
              Choose a service
            </option>
            {available.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </Select>
          {chosen && (
            <p className="text-xs text-fg-muted" aria-live="polite">
              {chosen.ownerTeam.name} will be responsible: they own{" "}
              {chosen.name}, whose criticality is{" "}
              {criticalityOf(chosen.criticality).label.toLowerCase()}.
            </p>
          )}
        </div>
        <SeveritySelect
          value={severity}
          onChange={setSeverity}
          error={fields.severity}
          placeholder="Choose a severity"
        />
        <TextArea
          label="Summary"
          name="summary"
          optional
          maxLength={2000}
          hint="What is known so far: who is affected and how."
          error={fields.summary}
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={declare.isPending}>
            {declare.isPending ? "Declaring…" : "Declare incident"}
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
      id="declare-incident"
      title="Declare an incident"
      description="An operational problem affecting one of this organization's services. It starts as Investigating."
    >
      {body}
    </Section>
  );
}

/** One row: what, where, who, and how it stands. */
function IncidentRow({
  incident,
  state,
}: {
  incident: IncidentResponse;
  state: IncidentState;
}) {
  const organization = useOrganization();

  return (
    <TR>
      <TD>
        <SeverityMark severity={incident.severity} />
      </TD>
      <TD className="max-w-md">
        <Link
          href={incidentHref(organization.slug, incident.number)}
          className="group flex min-w-0 items-baseline gap-2 underline-offset-2"
        >
          <span className="data shrink-0 text-fg-subtle">
            {incidentKey(incident.number)}
          </span>{" "}
          <span className="truncate font-medium text-fg group-hover:text-accent-text group-hover:underline">
            {incident.title}
          </span>
        </Link>
      </TD>
      <TD kind="muted" className="hidden sm:table-cell">
        {incident.service.name}
      </TD>
      <TD kind="muted" className="hidden md:table-cell">
        {incident.team.name}
      </TD>
      {state === "active" ? (
        <>
          <TD>{statusOf(incident.status).label}</TD>
          <TD kind="data" align="end">
            <Duration from={incident.createdAt} />
          </TD>
        </>
      ) : (
        <>
          <TD kind="data" className="hidden sm:table-cell">
            {incident.resolvedAt && <IsoDate value={incident.resolvedAt} />}
          </TD>
          <TD kind="data" align="end">
            <Duration from={incident.createdAt} to={incident.resolvedAt} />
          </TD>
        </>
      )}
    </TR>
  );
}

/**
 * One state's incidents: active ones most severe first, then longest
 * running; resolved ones most recent first. Pages load on request.
 */
function IncidentList({ state }: { state: IncidentState }) {
  const organization = useOrganization();
  const list = useIncidentList(organization.id, state);
  const active = state === "active";

  let content;

  if (list.isError) {
    content = <ErrorAlert error={list.error} />;
  } else if (!list.data) {
    content = (
      <Spinner
        label={active ? "Loading active incidents…" : "Loading resolved incidents…"}
      />
    );
  } else {
    const incidents = list.data.pages.flatMap((page) => page.items);

    content =
      incidents.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {active
            ? "No active incidents."
            : "No incidents have been resolved yet."}
        </p>
      ) : (
        <>
          <Table
            label={active ? "Active incidents" : "Resolved incidents"}
            density="compact"
          >
            <THead>
              <TR>
                <TH>Severity</TH>
                <TH>Incident</TH>
                <TH className="hidden sm:table-cell">Service</TH>
                <TH className="hidden md:table-cell">Responsible team</TH>
                {active ? (
                  <>
                    <TH>Status</TH>
                    <TH align="end">Duration</TH>
                  </>
                ) : (
                  <>
                    <TH className="hidden sm:table-cell">Resolved</TH>
                    <TH align="end">Lasted</TH>
                  </>
                )}
              </TR>
            </THead>
            <TBody>
              {incidents.map((incident) => (
                <IncidentRow
                  key={incident.id}
                  incident={incident}
                  state={state}
                />
              ))}
            </TBody>
          </Table>
          {list.hasNextPage && (
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </>
      );
  }

  return (
    <Section id={`${state}-incidents`} title={active ? "Active" : "Resolved"}>
      {content}
    </Section>
  );
}

/**
 * The Incidents page: what is happening now, what has been resolved, and —
 * for those the API says may respond — a form to declare an incident, opened
 * from the header.
 */
export function IncidentsView() {
  const organization = useOrganization();
  const canManage = useCan(Permission.INCIDENTS_MANAGE);
  const [declaring, setDeclaring] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow={organization.name}
        title="Incidents"
        description="Operational problems affecting this organization's services: who is responsible, how serious each is, and where the response stands."
        actions={
          canManage &&
          !declaring && (
            <Button onClick={() => setDeclaring(true)}>Declare incident</Button>
          )
        }
      />
      <PageBody>
        {canManage && declaring && (
          <DeclareIncidentForm onCancel={() => setDeclaring(false)} />
        )}
        <IncidentList state="active" />
        <IncidentList state="resolved" />
      </PageBody>
    </>
  );
}
