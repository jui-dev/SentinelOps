"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Circle, CircleCheck, Lock } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { TextArea } from "@/components/ui/field";
import { Duration, LocalDateTime } from "@/components/ui/timestamp";
import { ApiErrorCode } from "@/lib/api/contracts";
import type {
  IncidentDetailResponse,
  IncidentResponderResponse,
  IncidentResponse,
} from "@/lib/api/contracts";
import {
  completeIncidentResponse,
  startIncidentResponse,
} from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import {
  resolvedMeanwhile,
  storeIncident,
  useUpdateIncident,
} from "./incident-queries";
import { UpdateComposer } from "./incident-timeline";
import { incidentKey } from "./severity";

/** Someone started investigating between the page loading and resolving. */
const stillInvestigating = (error: unknown) =>
  isApiError(error, 409) &&
  error.code === ApiErrorCode.RESPONDERS_STILL_INVESTIGATING;

/** "1 responder", "2 responders". */
const responders = (count: number) =>
  `${count} ${count === 1 ? "responder" : "responders"}`;

/** "Priya Shah", "Priya Shah and Sam Okafor", "A, B, and C". */
const nameList = (names: readonly string[]) =>
  names.length <= 2
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;

/**
 * A responder's state as a glyph whose shape differs, not only its colour:
 * a filled accent dot while investigating, a check once complete.
 */
function ResponderMark({
  status,
  className,
}: {
  status: IncidentResponderResponse["status"];
  className?: string;
}) {
  return status === "INVESTIGATING" ? (
    <span
      aria-hidden="true"
      className={cx(
        "grid size-4 shrink-0 place-items-center",
        className,
      )}
    >
      <span className="size-2 rounded-full bg-accent" />
    </span>
  ) : (
    <CircleCheck
      aria-hidden="true"
      strokeWidth={2}
      className={cx("size-4 shrink-0 text-signal-nominal", className)}
    />
  );
}

/** Where one responder's own response stands, as ruled rows. */
function ResponderRows({
  list,
  dense = false,
}: {
  list: readonly IncidentResponderResponse[];
  dense?: boolean;
}) {
  return (
    <ul aria-label="Responders" className="divide-y divide-line-subtle">
      {list.map((responder) => {
        const investigating = responder.status === "INVESTIGATING";

        return (
          <li
            key={responder.membershipId}
            className={cx(
              "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3",
              dense ? "py-2" : "px-4 py-2.5 sm:px-5",
            )}
          >
            <ResponderMark status={responder.status} />
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="truncate text-sm font-medium text-fg">
                {responder.name}
              </span>
              <span
                className={cx(
                  "text-sm",
                  investigating ? "text-accent-text" : "text-success-text",
                )}
              >
                {investigating ? "Investigating" : "Response complete"}
              </span>
            </span>
            <span className="data text-xs whitespace-nowrap text-fg-muted">
              {investigating ? (
                <>
                  for <Duration from={responder.startedAt} />
                </>
              ) : (
                <LocalDateTime
                  value={responder.completedAt ?? responder.startedAt}
                />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Resolving, after an inline confirmation that asks how it ended: the note
 * is required, and is kept on the incident and its timeline. It cannot be
 * undone here.
 */
function Resolve({ incident }: { incident: IncidentResponse }) {
  const update = useUpdateIncident(incident);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [blank, setBlank] = useState(false);

  if (!confirming) {
    return <Button onClick={() => setConfirming(true)}>Resolve incident</Button>;
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const resolution = note.trim();

    if (resolution === "") {
      setBlank(true);
      return;
    }

    update.mutate({ status: "RESOLVED", resolution });
  };

  const fieldError = blank
    ? "Say how the incident was resolved."
    : fieldErrorsOf(update.error).resolution;

  return (
    <Alert tone="warning" title={`Resolve ${incidentKey(incident.number)}?`}>
      <p>
        A resolved incident is kept as it is and can no longer be changed or
        responded to. If the problem returns, declare a new incident.
      </p>
      {update.isError && !fieldError && (
        <ErrorAlert
          className="mt-2"
          error={update.error}
          message={
            resolvedMeanwhile(update.error)
              ? "Someone else resolved this incident already."
              : stillInvestigating(update.error)
                ? "Someone started investigating meanwhile, so it cannot be resolved yet. The incident has been refreshed."
                : undefined
          }
        />
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 pt-3">
        <TextArea
          label="How was it resolved?"
          name="resolution"
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setBlank(false);
          }}
          hint="What fixed it, or why it no longer needs a response. Kept with the incident and on its timeline."
          error={fieldError}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={update.isPending}>
            {update.isPending ? "Resolving…" : "Resolve incident"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={update.isPending}
            onClick={() => {
              setConfirming(false);
              setBlank(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Alert>
  );
}

type ResponseState = "awaiting" | "in-progress" | "complete" | "resolved";

/** Where the response stands, and what it is called. */
const responseStateOf = (incident: IncidentDetailResponse) => {
  const list = incident.responders;
  const investigating = list.filter(
    ({ status }) => status === "INVESTIGATING",
  );
  const state: ResponseState =
    incident.status === "RESOLVED"
      ? "resolved"
      : list.length === 0
        ? "awaiting"
        : investigating.length > 0
          ? "in-progress"
          : "complete";

  const title = {
    awaiting: "Awaiting team response",
    "in-progress": "Response in progress",
    complete: "Response work complete",
    resolved: "Response",
  }[state];

  return {
    state,
    title,
    list,
    investigating,
    complete: list.length - investigating.length,
  };
};

/** One count, the number first: how many, then of what. */
function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col">
      <dt className="order-2 text-xs text-fg-muted">{label}</dt>
      <dd className="numeric order-1 text-2xl leading-8 font-semibold text-fg">
        {value}
      </dd>
    </div>
  );
}

/**
 * Where the response stands — the page's operational centre for the Admin,
 * and for anyone following the incident. One framed panel, its edge and
 * glyph following the state: awaiting the team, in progress, complete — the
 * milestone at which the Admin resolves — or resolved. Counts are figures,
 * and each responder is a row with their own state.
 *
 * For the Admin it is also where the incident is resolved, and says who it is
 * waiting for until then.
 */
export function ResponsePanel({
  incident,
  canManage,
}: {
  incident: IncidentDetailResponse;
  canManage: boolean;
}) {
  const headingId = useId();
  const { state, title, list, investigating, complete } =
    responseStateOf(incident);
  const ready = canManage && incident.status === "INVESTIGATING" && investigating.length === 0;

  const summary = {
    awaiting: `${incident.team.name} has not started investigating yet.`,
    "in-progress": `${incident.team.name} is working on it.`,
    complete: `${responders(list.length)} completed their response.`,
    resolved:
      list.length === 0
        ? "No one responded to this incident."
        : `${responders(list.length)} responded to this incident.`,
  }[state];

  const Glyph =
    state === "complete" || state === "resolved" ? CircleCheck : Circle;

  return (
    <section
      aria-labelledby={headingId}
      className={cx(
        "overflow-hidden rounded-md border bg-surface",
        state === "in-progress" && "border-line border-l-[3px] border-l-accent",
        state === "complete" && "border-success-line border-l-[3px] border-l-success-solid",
        (state === "awaiting" || state === "resolved") && "border-line",
      )}
    >
      <div
        className={cx(
          "flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-5",
          state === "complete" && "bg-success-subtle",
        )}
      >
        <div className="flex min-w-0 gap-3">
          {state === "in-progress" ? (
            <ResponderMark status="INVESTIGATING" className="mt-1" />
          ) : (
            <Glyph
              aria-hidden="true"
              strokeWidth={2}
              className={cx(
                "mt-1 size-4 shrink-0",
                state === "complete"
                  ? "text-success-text"
                  : state === "resolved"
                    ? "text-signal-nominal"
                    : "text-fg-subtle",
              )}
            />
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-fg-muted">{summary}</p>
          </div>
        </div>
        {ready && <Resolve incident={incident} />}
      </div>
      {list.length > 0 && state !== "resolved" && (
        <div
          role="group"
          aria-label="Response counts"
          className="border-t border-line-subtle px-4 py-3 sm:px-5"
        >
          <dl className="flex gap-10">
            <Figure
              value={list.length}
              label={list.length === 1 ? "Responder" : "Responders"}
            />
            <Figure value={investigating.length} label="Investigating" />
            <Figure value={complete} label="Complete" />
          </dl>
        </div>
      )}
      {list.length > 0 && (
        <div className="border-t border-line-subtle">
          <ResponderRows list={list} />
        </div>
      )}
      {canManage && state === "in-progress" && (
        <p className="flex items-start gap-2 border-t border-line-subtle px-4 py-3 text-sm text-fg-muted sm:px-5">
          <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Resolve becomes available when{" "}
            {nameList(investigating.map(({ name }) => name))}{" "}
            {investigating.length === 1
              ? "completes their response"
              : "complete their responses"}
            .
          </span>
        </p>
      )}
    </section>
  );
}

/**
 * The team's response, secondary, beneath a member's own: where it stands
 * in a line, and who is doing what — without the Admin's figures or
 * resolution.
 */
export function TeamResponse({ incident }: { incident: IncidentDetailResponse }) {
  const headingId = useId();
  const { title, list, investigating, complete } = responseStateOf(incident);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={headingId} className="text-sm font-semibold text-fg">
          Team response
        </h2>
        <span className="text-sm text-fg-muted">
          {title === "Response" ? "Ended" : title}
          {list.length > 0 &&
            ` · ${investigating.length} investigating · ${complete} complete`}
        </span>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No one on {incident.team.name} has started investigating yet.
        </p>
      ) : (
        <ResponderRows list={list} dense />
      )}
    </section>
  );
}

/** What a refused start or completion means, in words. */
export const responseErrorMessage = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.INCIDENT_RESOLVED:
      return "This incident was resolved meanwhile, so it no longer takes responses. It has been refreshed.";
    case ApiErrorCode.NOT_ON_RESPONSIBLE_TEAM:
      return "This incident is no longer your team's to respond to — it may have been reassigned. It has been refreshed.";
    case ApiErrorCode.RESPONSE_ALREADY_COMPLETED:
      return "Your response to this incident is already complete. It has been refreshed.";
    case ApiErrorCode.NOT_INVESTIGATING:
      return "You are not investigating this incident. It has been refreshed.";
    default:
      return undefined;
  }
};

/**
 * Starting and completing the caller's own response. The API's answer — the
 * incident with its responders — replaces the cached incident, and the
 * timeline refetches. A refusal means the page was out of date: the incident
 * and its team are fetched again.
 */
export const useOwnResponse = (incident: IncidentResponse) => {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  const options = {
    onSuccess: (updated: IncidentDetailResponse) =>
      storeIncident(queryClient, organization.id, updated),
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.incidents(organization.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teamMembers(organization.id, incident.team.id),
      });
    },
  };

  const start = useMutation({
    mutationFn: () => startIncidentResponse(organization.id, incident.number),
    ...options,
  });
  const complete = useMutation({
    mutationFn: () =>
      completeIncidentResponse(organization.id, incident.number),
    ...options,
  });

  return { start, complete };
};

export type OwnResponse = ReturnType<typeof useOwnResponse>;

/**
 * The caller's own part in the response — a member's working area. Before
 * they start: why it is theirs, and Start investigating. While
 * investigating: since when, the update composer, and Mark my response
 * complete. After: that their part is done. Once the incident is resolved,
 * only where their response ended.
 */
export function YourResponse({
  incident,
  own,
  actions,
}: {
  incident: IncidentResponse;
  own: IncidentResponderResponse | undefined;
  actions: OwnResponse;
}) {
  const headingId = useId();
  const active = incident.status !== "RESOLVED";
  const pending = actions.start.isPending || actions.complete.isPending;
  const investigating = own?.status === "INVESTIGATING";

  return (
    <section
      aria-labelledby={headingId}
      className={cx(
        "overflow-hidden rounded-md border bg-surface",
        investigating && "border-line border-l-[3px] border-l-accent",
        own?.status === "COMPLETED" &&
          "border-success-line border-l-[3px] border-l-success-solid",
        !own && "border-accent-line",
      )}
    >
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <h2 id={headingId} className="label-caps text-fg-subtle">
          Your response
        </h2>
        {!own ? (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="text-base font-semibold text-fg">
                You are on {incident.team.name}, the team responsible for this
                incident.
              </p>
              <p className="mt-0.5 text-sm text-fg-muted">
                You have not started responding to this incident.
              </p>
            </div>
            <Button disabled={pending} onClick={() => actions.start.mutate()}>
              {actions.start.isPending ? "Starting…" : "Start investigating"}
            </Button>
          </div>
        ) : investigating ? (
          <div className="flex gap-3">
            <ResponderMark status="INVESTIGATING" className="mt-1" />
            <div>
              <p className="text-base font-semibold text-fg">
                You are investigating
              </p>
              <p className="text-sm text-fg-muted">
                Started <LocalDateTime value={own.startedAt} /> ·{" "}
                <span className="data">
                  <Duration from={own.startedAt} />
                </span>{" "}
                ago
              </p>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <ResponderMark status="COMPLETED" className="mt-1" />
            <div>
              <p className="text-base font-semibold text-fg">
                Response complete
              </p>
              <p className="text-sm text-fg-muted">
                Your response work on this incident is complete
                {own.completedAt && (
                  <>
                    {" "}
                    (<LocalDateTime value={own.completedAt} />)
                  </>
                )}
                .
              </p>
            </div>
          </div>
        )}
        {investigating && active && (
          <UpdateComposer
            incident={incident}
            hint="Updates go on the timeline, for your team and the Admin."
          />
        )}
      </div>
      {investigating && active && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line-subtle bg-sunken/40 px-4 py-3 sm:px-5">
          <p className="text-sm text-fg-muted">
            Done with your part? Completing your response does not resolve the
            incident.
          </p>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => actions.complete.mutate()}
          >
            {actions.complete.isPending
              ? "Completing…"
              : "Mark my response complete"}
          </Button>
        </div>
      )}
    </section>
  );
}
