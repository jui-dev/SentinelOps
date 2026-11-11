"use client";

import { Settings2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, MouseEvent } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { useTeams } from "@/components/teams/team-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, TextArea } from "@/components/ui/field";
import { Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { MODAL_BACKDROP } from "@/components/ui/modal";
import {
  RequiredNote,
  SubmitHint,
  useRequiredFields,
} from "@/components/ui/required";
import { ApiErrorCode } from "@/lib/api/contracts";
import type {
  IncidentResponse,
  IncidentSeverity,
  UpdateIncidentRequest,
} from "@/lib/api/contracts";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";

import {
  RESOLVED_MEANWHILE_MESSAGE,
  resolvedMeanwhile,
  useUpdateIncident,
} from "./incident-queries";
import { SeveritySelect } from "./incidents-view";
import { useServiceKnownIssues } from "@/components/known-issues/known-issue-queries";
import { incidentKey } from "./severity";

/**
 * How serious the incident is and which team is responsible for it. Only
 * what changed is sent.
 */
function SeverityAndTeamForm({ incident }: { incident: IncidentResponse }) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const update = useUpdateIncident(incident);
  const [severity, setSeverity] = useState<IncidentSeverity>(
    incident.severity,
  );
  const [teamId, setTeamId] = useState(incident.team.id);
  const [saved, setSaved] = useState(false);

  const changes: UpdateIncidentRequest = {
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
      id="severity-and-team"
      title="Severity and responsible team"
      level={3}
      description="Both can change as the response unfolds. Each change is recorded on the timeline."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
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
            hint="Moving it clears who was assigned, and you choose again who responds. Anyone already investigating keeps their response."
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

/**
 * Which known issue it is, if any: one of its own service's, or none. For
 * correcting a choice made while declaring; the title stays as it is.
 */
function KnownIssueForm({ incident }: { incident: IncidentResponse }) {
  const organization = useOrganization();
  const knownIssues = useServiceKnownIssues(organization.id, incident.service.id);
  const update = useUpdateIncident(incident);
  const current = incident.knownIssue?.id ?? "";
  const [chosen, setChosen] = useState(current);
  const [saved, setSaved] = useState(false);
  const unavailable =
    (isApiError(update.error, 404) &&
      update.error.code === ApiErrorCode.KNOWN_ISSUE_NOT_FOUND) ||
    (isApiError(update.error, 409) &&
      update.error.code === ApiErrorCode.KNOWN_ISSUE_ARCHIVED);
  const fields = fieldErrorsOf(update.error);
  // The service's in use, and the one linked now even if since archived.
  const options = [
    ...(incident.knownIssue &&
    !knownIssues.data?.some(({ id }) => id === incident.knownIssue?.id)
      ? [{ id: incident.knownIssue.id, name: incident.knownIssue.name }]
      : []),
    ...(knownIssues.data ?? []),
  ];

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(false);
    update.mutate(
      { knownIssueId: chosen === "" ? null : chosen },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <Section
      id="known-issue"
      title="Known issue"
      level={3}
      description={`Which of ${incident.service.name}'s known issues this is, so its repeats are counted together. Its title stays as it is.`}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {update.isError && !unavailable && Object.keys(fields).length === 0 && (
          <ErrorAlert
            error={update.error}
            message={
              resolvedMeanwhile(update.error)
                ? RESOLVED_MEANWHILE_MESSAGE
                : undefined
            }
          />
        )}
        {saved && <Alert tone="success">Known issue updated.</Alert>}
        {knownIssues.isError ? (
          <ErrorAlert error={knownIssues.error} />
        ) : !knownIssues.data ? (
          <Spinner label="Loading known issues…" />
        ) : (
          <Select
            label="Known issue"
            name="knownIssueId"
            value={chosen}
            onChange={(event) => {
              setSaved(false);
              setChosen(event.target.value);
            }}
            hint={
              options.length === 0
                ? `${incident.service.name} has no known issues yet.`
                : undefined
            }
            error={
              unavailable
                ? "That known issue is no longer available. The list has been refreshed."
                : fields.knownIssueId
            }
          >
            <option value="">None: a one-off</option>
            {options.map((issue) => (
              <option key={issue.id} value={issue.id}>
                {issue.name}
              </option>
            ))}
          </Select>
        )}
        <div>
          <Button
            type="submit"
            disabled={chosen === current || update.isPending}
          >
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
  const { attach: requiredRef, ...required } = useRequiredFields();

  return (
    <Section id="details" title="Title and summary" level={3}>
      <form
        ref={requiredRef}
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-4"
      >
        <RequiredNote />
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
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={update.isPending || !required.ready}
            aria-describedby={required.ready ? undefined : required.hintId}
          >
            {update.isPending ? "Saving…" : "Save details"}
          </Button>
          <SubmitHint id={required.hintId} missing={required.missing} />
        </div>
      </form>
    </Section>
  );
}

/**
 * The Admin's controls over an active incident, apart from resolving it —
 * its severity and responsible team, and its wording — in a drawer from the
 * right edge, so they do not compete with the response for the page.
 *
 * A native <dialog> opened with showModal(), as the navigation drawer and the
 * date-range dialog are: the page is inert behind it and focus stays inside.
 * Escape, a click on the backdrop, and Close dismiss it, and focus returns to
 * what opened it. Mounted only while open.
 */
function ManageIncidentDrawer({
  incident,
  onClose,
}: {
  incident: IncidentResponse;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

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
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={onClick}
      className={`fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(30rem,100vw)] max-w-none border-l border-line bg-surface p-0 text-fg shadow-overlay ${MODAL_BACKDROP}`}
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line-subtle px-5 py-3">
          <div className="min-w-0">
            <p className="data text-xs text-fg-muted">
              {incidentKey(incident.number)}
            </p>
            <h2 id={headingId} className="text-[0.9375rem] font-semibold text-fg">
              Manage incident
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-5 py-5">
          <SeverityAndTeamForm
            key={`${incident.severity}-${incident.team.id}`}
            incident={incident}
          />
          <DetailsForm
            key={`${incident.title}-${incident.summary}`}
            incident={incident}
          />
          <KnownIssueForm
            key={incident.knownIssue?.id ?? "none"}
            incident={incident}
          />
        </div>
      </div>
    </dialog>
  );
}

/** The header's way into managing the incident, for the Admin while active. */
export function ManageIncident({ incident }: { incident: IncidentResponse }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Settings2 aria-hidden="true" className="size-4" />
        Manage incident
      </Button>
      {open && (
        <ManageIncidentDrawer
          incident={incident}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
