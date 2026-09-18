"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { criticalityOf } from "@/components/services/criticality";
import { serviceHref } from "@/components/services/service-scope";
import { teamHref, useTeams } from "@/components/teams/team-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, TextArea } from "@/components/ui/field";
import { PageBody, PageHeader, Section } from "@/components/ui/page";
import { RecordList, RecordRow } from "@/components/ui/record";
import { Select } from "@/components/ui/select";
import { PageSpinner, Spinner } from "@/components/ui/spinner";
import { Duration, IsoDate, LocalDateTime } from "@/components/ui/timestamp";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type {
  IncidentResponse,
  IncidentSeverity,
  IncidentStatus,
  UpdateIncidentRequest,
} from "@/lib/api/contracts";
import { updateIncident } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import {
  incidentsHref,
  storeIncident,
  useIncident,
} from "./incident-queries";
import { SeveritySelect } from "./incidents-view";
import {
  ACTIVE_STATUSES,
  incidentKey,
  SeverityMark,
  severityOf,
  statusOf,
} from "./severity";

const linkClasses =
  "font-medium text-fg underline-offset-2 hover:text-accent-text hover:underline";

export const RESOLVED_MEANWHILE_MESSAGE =
  "This incident was resolved by someone else, so it can no longer be changed. It has been refreshed.";

/** The incident number in the URL, or undefined when it cannot be one. */
const parseNumber = (value: string): number | undefined =>
  /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 2_147_483_647
    ? Number(value)
    : undefined;

/**
 * Changes the incident. The API's answer replaces the cached incident and the
 * lists refetch. Refused because it was resolved or has gone meanwhile: the
 * incident is fetched again, so the page shows why.
 */
const useUpdateIncident = (incident: IncidentResponse) => {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateIncidentRequest) =>
      updateIncident(organization.id, incident.number, body),
    onSuccess: (updated) =>
      storeIncident(queryClient, organization.id, updated),
    onError: (error) => {
      if (isApiError(error, 404) || isApiError(error, 409)) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.incidents(organization.id),
        });
      }
    },
  });
};

const resolvedMeanwhile = (error: unknown) =>
  isApiError(error, 409) && error.code === ApiErrorCode.INCIDENT_RESOLVED;

/**
 * Where the response stands: status, severity, and the responsible team.
 * Only what changed is sent. Resolving is its own action, not a status here.
 */
function ResponseForm({ incident }: { incident: IncidentResponse }) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const update = useUpdateIncident(incident);
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [severity, setSeverity] = useState<IncidentSeverity>(
    incident.severity,
  );
  const [teamId, setTeamId] = useState(incident.team.id);
  const [saved, setSaved] = useState(false);

  const changes: UpdateIncidentRequest = {
    ...(status !== incident.status && { status }),
    ...(severity !== incident.severity && { severity }),
    ...(teamId !== incident.team.id && { teamId }),
  };
  const unchanged = Object.keys(changes).length === 0;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(false);
    update.mutate(changes, { onSuccess: () => setSaved(true) });
  };

  const teamGone =
    isApiError(update.error, 404) &&
    update.error.code === ApiErrorCode.TEAM_NOT_FOUND;
  const fields = fieldErrorsOf(update.error);

  return (
    <Section
      id="response"
      title="Response"
      description="Statuses can move in either direction as the response unfolds."
    >
      <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-4">
        {update.isError && !teamGone && Object.keys(fields).length === 0 && (
          <ErrorAlert
            error={update.error}
            message={
              resolvedMeanwhile(update.error)
                ? RESOLVED_MEANWHILE_MESSAGE
                : undefined
            }
          />
        )}
        {saved && <Alert tone="success">Incident updated.</Alert>}
        <Select
          label="Status"
          name="status"
          value={status}
          onChange={(event) => {
            setSaved(false);
            setStatus(event.target.value as IncidentStatus);
          }}
          hint={statusOf(status).definition}
          error={fields.status}
        >
          {ACTIVE_STATUSES.map((level) => (
            <option key={level.value} value={level.value}>
              {level.label}
            </option>
          ))}
        </Select>
        <SeveritySelect
          value={severity}
          onChange={(value) => {
            setSaved(false);
            setSeverity(value);
          }}
          error={fields.severity}
        />
        {teams.isError ? (
          <ErrorAlert error={teams.error} />
        ) : !teams.data ? (
          <Spinner label="Loading teams…" />
        ) : (
          <Select
            label="Responsible team"
            name="teamId"
            value={teamId}
            onChange={(event) => {
              setSaved(false);
              setTeamId(event.target.value);
            }}
            hint={`${incident.service.name} is owned by its owner team; the responsible team can differ.`}
            error={
              teamGone
                ? "That team no longer exists. The list of teams has been refreshed."
                : fields.teamId
            }
          >
            {teams.data.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        )}
        <div>
          <Button type="submit" disabled={unchanged || update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** The title and summary, edited together. */
function DetailsForm({ incident }: { incident: IncidentResponse }) {
  const update = useUpdateIncident(incident);
  const [saved, setSaved] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setSaved(false);
    update.mutate(
      {
        title: String(data.get("title") ?? ""),
        summary: String(data.get("summary") ?? ""),
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  const fields = fieldErrorsOf(update.error);

  return (
    <Section id="details" title="Details">
      <form onSubmit={onSubmit} noValidate className="flex max-w-xl flex-col gap-4">
        {update.isError && Object.keys(fields).length === 0 && (
          <ErrorAlert
            error={update.error}
            message={
              resolvedMeanwhile(update.error)
                ? RESOLVED_MEANWHILE_MESSAGE
                : undefined
            }
          />
        )}
        {saved && <Alert tone="success">Details saved.</Alert>}
        <Field
          label="Title"
          name="title"
          defaultValue={incident.title}
          required
          maxLength={200}
          autoComplete="off"
          error={fields.title}
        />
        <TextArea
          label="Summary"
          name="summary"
          defaultValue={incident.summary ?? ""}
          optional
          maxLength={2000}
          error={fields.summary}
        />
        <div>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save details"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** Resolving, after an inline confirmation: it cannot be undone here. */
function Resolve({ incident }: { incident: IncidentResponse }) {
  const update = useUpdateIncident(incident);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Resolve…
      </Button>
    );
  }

  return (
    <Alert tone="warning" title={`Resolve ${incidentKey(incident.number)}?`}>
      <p>
        A resolved incident is kept as it is and can no longer be changed. If
        the problem returns, declare a new incident.
      </p>
      {update.isError && (
        <ErrorAlert
          className="mt-2"
          error={update.error}
          message={
            resolvedMeanwhile(update.error)
              ? "Someone else resolved this incident already."
              : undefined
          }
        />
      )}
      <div className="flex gap-2 pt-2">
        <Button
          size="sm"
          disabled={update.isPending}
          onClick={() => update.mutate({ status: "RESOLVED" })}
        >
          {update.isPending ? "Resolving…" : "Resolve incident"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={update.isPending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
    </Alert>
  );
}

function IncidentNotFound({ orgSlug }: { orgSlug: string }) {
  return (
    <PageBody width="form">
      <EmptyState
        className="mt-6"
        headingLevel={1}
        title="Incident not found"
        action={
          <Link
            href={incidentsHref(orgSlug)}
            className="text-sm font-medium text-accent-text underline-offset-2 hover:underline"
          >
            All incidents
          </Link>
        }
      >
        <p>There is no incident with this number in this organization.</p>
      </EmptyState>
    </PageBody>
  );
}

function IncidentPage({ incident }: { incident: IncidentResponse }) {
  const organization = useOrganization();
  const canManage = useCan(Permission.INCIDENTS_MANAGE);
  const resolved = incident.status === "RESOLVED";
  const severity = severityOf(incident.severity);
  const status = statusOf(incident.status);
  const criticality = criticalityOf(incident.service.criticality);

  return (
    <>
      <PageHeader
        eyebrow={`${organization.name} · ${incidentKey(incident.number)}`}
        title={incident.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <SeverityMark severity={incident.severity} label />
            <span aria-hidden="true">·</span>
            <span className="font-medium text-fg">{status.label}</span>
          </span>
        }
        actions={canManage && !resolved && <Resolve incident={incident} />}
      />
      <PageBody width="form">
        {resolved && incident.resolvedAt && (
          <Alert tone="info" title="Resolved">
            <p>
              Resolved <LocalDateTime value={incident.resolvedAt} />. A
              resolved incident is kept as it is; if the problem returns,
              declare a new incident.
            </p>
          </Alert>
        )}
        <div className="flex flex-col gap-8">
          <RecordList>
            <RecordRow label="Severity">
              <SeverityMark severity={incident.severity} label />
              {severity.definition && (
                <span className="mt-0.5 block text-sm text-fg-muted">
                  {severity.definition}
                </span>
              )}
            </RecordRow>
            <RecordRow label="Status">
              <span className="font-medium">{status.label}</span>
              {status.definition && (
                <span className="mt-0.5 block text-sm text-fg-muted">
                  {status.definition}
                </span>
              )}
            </RecordRow>
            <RecordRow label="Service">
              <Link
                href={serviceHref(organization.slug, incident.service.slug)}
                className={linkClasses}
              >
                {incident.service.name}
              </Link>
              {incident.service.archivedAt && (
                <span className="text-fg-muted"> (archived)</span>
              )}
            </RecordRow>
            <RecordRow label="Responsible team">
              <Link
                href={teamHref(organization.slug, incident.team.slug)}
                className={linkClasses}
              >
                {incident.team.name}
              </Link>
            </RecordRow>
            <RecordRow label="Service criticality">
              {criticality.label}
            </RecordRow>
            <RecordRow label="Declared by">{incident.createdBy.name}</RecordRow>
            <RecordRow label="Declared">
              <LocalDateTime value={incident.createdAt} />
            </RecordRow>
            {incident.resolvedAt && (
              <RecordRow label="Resolved">
                <LocalDateTime value={incident.resolvedAt} />
              </RecordRow>
            )}
            <RecordRow label={resolved ? "Lasted" : "Duration"}>
              <span className="data">
                <Duration from={incident.createdAt} to={incident.resolvedAt} />
              </span>
            </RecordRow>
          </RecordList>
          <Section id="summary" title="Summary">
            {incident.summary ? (
              <p className="max-w-2xl text-sm whitespace-pre-line text-fg">
                {incident.summary}
              </p>
            ) : (
              <p className="text-sm text-fg-muted">No summary yet.</p>
            )}
          </Section>
          {canManage && !resolved && (
            <>
              <ResponseForm
                key={`${incident.status}-${incident.severity}-${incident.team.id}`}
                incident={incident}
              />
              <DetailsForm
                key={`${incident.title}-${incident.summary}`}
                incident={incident}
              />
            </>
          )}
          <RecordList tone="secondary">
            <RecordRow label="Last changed">
              <IsoDate value={incident.updatedAt} />
            </RecordRow>
          </RecordList>
        </div>
      </PageBody>
    </>
  );
}

/**
 * One incident, at `/incidents/[incidentNumber]`: what it is, where the
 * response stands, and — for those who may respond, while it is active — the
 * controls to move it on. Only what the incident record holds; its timeline
 * arrives with the timeline.
 */
export function IncidentDetail() {
  const organization = useOrganization();
  const { orgSlug, incidentNumber } = useParams<{
    orgSlug: string;
    incidentNumber: string;
  }>();
  const number = parseNumber(incidentNumber);

  if (number === undefined) return <IncidentNotFound orgSlug={orgSlug} />;

  return (
    <LoadedIncident
      organizationId={organization.id}
      number={number}
      orgSlug={orgSlug}
    />
  );
}

function LoadedIncident({
  organizationId,
  number,
  orgSlug,
}: {
  organizationId: string;
  number: number;
  orgSlug: string;
}) {
  const incident = useIncident(organizationId, number);

  if (isApiError(incident.error, 404)) {
    return <IncidentNotFound orgSlug={orgSlug} />;
  }

  if (incident.isError) {
    return (
      <PageBody width="form">
        <ErrorAlert error={incident.error} />
      </PageBody>
    );
  }

  if (!incident.data) return <PageSpinner />;

  return <IncidentPage incident={incident.data} />;
}
