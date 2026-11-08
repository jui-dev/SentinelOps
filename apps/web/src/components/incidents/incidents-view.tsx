"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { EmptyNote, EmptyState } from "@/components/ui/empty-state";
import { Field, TextArea } from "@/components/ui/field";
import { OnwardLink } from "@/components/ui/onward-link";
import { PageBody, PageHeader, Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { linkClasses } from "@/components/ui/link";
import {
  RequiredNote,
  SubmitHint,
  useRequiredFields,
} from "@/components/ui/required";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type {
  CreateIncidentRequest,
  IncidentPeriod,
  IncidentSeverity,
  IncidentState,
} from "@/lib/api/contracts";
import { createIncident } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { formatPeriodRange, readPeriodParams } from "@/lib/period/period";

import {
  IncidentFilterBar,
  useIncidentFilters,
  useReplaceParams,
} from "./incident-filters";
import {
  incidentHistoryHref,
  incidentHref,
  storeIncident,
  useIncidentList,
} from "./incident-queries";
import { IncidentTable } from "./incident-table";
import { SEVERITY_LEVELS, severityOf } from "./severity";

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
      // With nothing chosen to start from — a declaration — choosing is required.
      required={placeholder !== undefined}
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
  const { attach: requiredRef, ...required } = useRequiredFields();

  if (services.isError) return <ErrorAlert error={services.error} />;
  if (!available) return <Spinner label="Loading services…" />;

  if (available.length === 0) {
    return (
      <EmptyState
        title="Add a service first"
        action={
          <div className="flex items-center gap-4">
            {canManageServices && (
              <Link
                href={servicesHref(organization.slug)}
                className={`text-sm ${linkClasses}`}
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
          {canManageServices ? "" : " The Admin can add one."}
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
      <RequiredNote />
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
          required
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
      <DialogActions>
        <SubmitHint id={required.hintId} missing={required.missing} />
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={declare.isPending || !required.ready}
          aria-describedby={required.ready ? undefined : required.hintId}
        >
          {declare.isPending ? "Declaring…" : "Declare incident"}
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * One state's incidents: active ones most severe first, then longest
 * running; resolved ones most recent first. Pages load on request.
 */
function IncidentList({
  state,
  period,
  filters,
}: {
  state: IncidentState;
  period?: IncidentPeriod;
  filters: ReturnType<typeof useIncidentFilters>;
}) {
  const organization = useOrganization();
  const list = useIncidentList(
    organization.id,
    state,
    period,
    filters.filters,
    !filters.pending,
  );
  const active = state === "active";

  let content;
  // A count only when every page is here: never an estimate.
  let count: number | undefined;

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

    if (active && !list.hasNextPage) count = incidents.length;

    content =
      incidents.length === 0 && filters.active ? (
        <EmptyNote
          title={active ? "No active incidents match" : "No resolved incidents match"}
        >
          {period
            ? "Nothing in this range matches the filters."
            : "Nothing matches the filters. Clear them to see every incident."}
        </EmptyNote>
      ) : incidents.length === 0 ? (
        active ? (
          <EmptyNote
            title={
              period ? "None declared in this range" : "No active incidents"
            }
            // The nominal mark: a real state, said in words as well.
            glyph={
              <svg viewBox="0 0 10 10" className="size-2.5 text-signal-nominal">
                <circle cx="5" cy="5" r="3.75" fill="currentColor" />
              </svg>
            }
          >
            {period
              ? "No incident still running was declared between these dates."
              : "Nothing needs a response right now."}
          </EmptyNote>
        ) : (
          <EmptyNote
            title={
              period ? "None resolved in this range" : "No resolved incidents"
            }
          >
            {period
              ? "No incident was resolved between these dates."
              : "Incidents appear here once resolved, most recent first."}
          </EmptyNote>
        )
      ) : (
        <>
          <IncidentTable
            incidents={incidents}
            state={state}
            label={active ? "Active incidents" : "Resolved incidents"}
            stickyHeader
          />
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
    <Section
      id={`${state}-incidents`}
      title={active ? "Active" : "Resolved"}
      meta={count}
      description={
        period &&
        (active ? "Declared in this range." : "Resolved in this range.")
      }
    >
      {content}
    </Section>
  );
}

/**
 * The Incidents page: what is happening now, what has been resolved, and —
 * for those the API says may respond — a dialog to declare an incident,
 * opened from the header. Declaring opens the new incident.
 */
export function IncidentsView() {
  const organization = useOrganization();
  const canManage = useCan(Permission.INCIDENTS_MANAGE);
  // Incident history reads the organization's whole record, so it is offered
  // only to a caller who may see it — never a link to an empty page.
  const canReadEveryIncident = useCan(Permission.INCIDENTS_READ_ALL);
  const [declaring, setDeclaring] = useState(false);
  const searchParams = useSearchParams();
  const replace = useReplaceParams();
  const pathname = usePathname();
  const { period, invalid } = readPeriodParams(
    searchParams.get("from"),
    searchParams.get("to"),
  );
  const filters = useIncidentFilters();

  // A range the API would refuse, or a filter that can never apply, is
  // taken out of the URL rather than quietly ignored, so the address and
  // the incidents shown always agree. Everything else in it is kept.
  const drop = [...(invalid ? ["from", "to"] : []), ...filters.invalid].join(",");

  useEffect(() => {
    if (drop) replace((params) => drop.split(",").forEach((name) => params.delete(name)));
    // `replace` is rebuilt every render; which parameters to drop is what
    // decides whether anything happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop]);

  // The period's Clear keeps the filters, as their Clear keeps the period.
  const withoutPeriod = new URLSearchParams(searchParams);

  withoutPeriod.delete("from");
  withoutPeriod.delete("to");

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Operational problems affecting this organization's services: who is responsible, how serious each is, and where the response stands."
        actions={
          // A phone wraps the link above the button rather than crowding it.
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            {canReadEveryIncident && (
              <OnwardLink href={incidentHistoryHref(organization.slug)}>
                Incident history
              </OnwardLink>
            )}
            {canManage && (
              <Button onClick={() => setDeclaring(true)}>
                Declare incident
              </Button>
            )}
          </div>
        }
      />
      <PageBody>
        {period && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span className="data text-fg">{formatPeriodRange(period)}</span>
            <span>(UTC)</span>
            <span aria-hidden="true" className="text-fg-subtle">
              ·
            </span>
            <Link
              href={
                withoutPeriod.size > 0 ? `${pathname}?${withoutPeriod}` : pathname
              }
              className={linkClasses}
            >
              Clear
            </Link>
          </p>
        )}
        <IncidentFilterBar active={filters.active} error={filters.error} />
        <IncidentList state="active" period={period} filters={filters} />
        <IncidentList state="resolved" period={period} filters={filters} />
      </PageBody>
      {canManage && declaring && (
        <FormDialog
          title="Declare an incident"
          description="An operational problem affecting one of this organization's services. It starts as Declared."
          onClose={() => setDeclaring(false)}
        >
          <DeclareIncidentForm onCancel={() => setDeclaring(false)} />
        </FormDialog>
      )}
    </>
  );
}
