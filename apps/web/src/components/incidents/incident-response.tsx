"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Lock } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { DetailCard } from "@/components/ui/detail-layout";
import { TextArea } from "@/components/ui/field";
import { Duration, LocalDateTime } from "@/components/ui/timestamp";
import { SubmitHint, useRequiredFields } from "@/components/ui/required";
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

/** Up to two initials, for a person's avatar. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

/**
 * A person's initials in a small circle, tinted by where their part stands:
 * blue while investigating, teal once complete, quiet when they have not
 * joined. Decoration: their name is written beside it.
 */
export function Avatar({
  name,
  tone,
  size = "md",
}: {
  name: string;
  tone: "investigating" | "complete" | "quiet";
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid shrink-0 place-items-center rounded-full border font-semibold",
        size === "md" ? "size-7.5 text-[0.6875rem]" : "size-6.5 text-[0.625rem]",
        tone === "investigating" &&
          "border-status-investigating-line bg-status-investigating-subtle text-status-investigating-text",
        tone === "complete" &&
          "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text",
        tone === "quiet" && "border-line bg-sunken text-fg-subtle",
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Where each responder's own part stands, as ruled rows. */
function ResponderRows({ list }: { list: readonly IncidentResponderResponse[] }) {
  return (
    <ul aria-label="Responders" className="divide-y divide-line-subtle">
      {list.map((responder) => {
        const investigating = responder.status === "INVESTIGATING";

        return (
          <li
            key={responder.membershipId}
            className="flex items-center gap-3 px-4 py-2.5 sm:px-5"
          >
            <Avatar
              name={responder.name}
              tone={investigating ? "investigating" : "complete"}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
              {responder.name}
            </span>
            {investigating ? (
              <span className="flex items-center gap-1.5 text-sm whitespace-nowrap text-status-investigating-text">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-status-investigating-text"
                />
                Investigating
                <span className="data text-xs">
                  for <Duration from={responder.startedAt} />
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm whitespace-nowrap text-status-resolved-text">
                <CircleCheck aria-hidden="true" strokeWidth={2} className="size-3.5" />
                Response complete
                <span className="data text-xs">
                  after{" "}
                  <Duration
                    from={responder.startedAt}
                    to={responder.completedAt ?? responder.startedAt}
                  />
                </span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Resolving, confirmed inline with how it ended: the note is required, and
 * is kept on the incident and its timeline. It cannot be undone here.
 */
function ResolveForm({
  incident,
  onCancel,
}: {
  incident: IncidentResponse;
  onCancel: () => void;
}) {
  const update = useUpdateIncident(incident);
  const [note, setNote] = useState("");
  const [blank, setBlank] = useState(false);
  const { attach: requiredRef, ...required } = useRequiredFields();

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
    <div className="border-b border-line-subtle p-4 sm:px-5">
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
        <form
          ref={requiredRef}
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-3 pt-3"
        >
          <TextArea
            label="How was it resolved?"
            name="resolution"
            required
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={update.isPending || !required.ready}
              aria-describedby={required.ready ? undefined : required.hintId}
            >
              {update.isPending ? "Resolving…" : "Resolve incident"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={update.isPending}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <SubmitHint id={required.hintId} missing={required.missing} />
          </div>
        </form>
      </Alert>
    </div>
  );
}

type ResponseState = "awaiting" | "in-progress" | "complete" | "resolved";

/** Where the response stands, what it is called, and its counts. */
export const responseStateOf = (incident: IncidentDetailResponse) => {
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

/**
 * Where the response stands, for everyone: its state as the card's title,
 * a line beside it, and each responder as a row with their own part. For
 * the Admin it is also where the incident is resolved — confirmed inline,
 * with how it ended — and, until it can be, says who it is waiting for.
 */
export function ResponseCard({
  incident,
  canManage,
}: {
  incident: IncidentDetailResponse;
  canManage: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const { state, title, list, investigating, complete } =
    responseStateOf(incident);
  const ready =
    canManage && incident.status === "INVESTIGATING" && investigating.length === 0;

  const aside = {
    awaiting: `${incident.team.name} has not started investigating yet.`,
    "in-progress": `${investigating.length} investigating · ${complete} complete`,
    complete: `${responders(list.length)} completed their response.`,
    resolved:
      list.length === 0
        ? "No one responded to this incident."
        : `${responders(list.length)} responded to this incident.`,
  }[state];

  return (
    <DetailCard
      id="response"
      title={title}
      aside={aside}
      action={
        ready &&
        !confirming && (
          <Button size="sm" onClick={() => setConfirming(true)}>
            Resolve incident
          </Button>
        )
      }
      className={cx(
        state === "in-progress" && "border-l-[3px] border-l-status-investigating-text",
        state === "complete" &&
          "border-status-resolved-line border-l-[3px] border-l-status-resolved-text",
      )}
    >
      {ready && confirming && (
        <ResolveForm incident={incident} onCancel={() => setConfirming(false)} />
      )}
      {list.length > 0 ? (
        <ResponderRows list={list} />
      ) : (
        <p className="px-4 py-3 text-sm text-fg-muted sm:px-5">
          {state === "resolved"
            ? "No one responded."
            : `Anyone on ${incident.team.name} can start investigating.`}
        </p>
      )}
      {canManage && state === "in-progress" && (
        <p className="flex items-start gap-2 border-t border-line-subtle bg-sunken/40 px-4 py-2.5 text-sm text-fg-muted sm:px-5">
          <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning-text" />
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
    </DetailCard>
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
 * The caller's own part — a member's working area, above the team's. Before
 * they start: why it is theirs, and Start investigating. While
 * investigating: since when, and Mark my response complete; their updates
 * go on the timeline beneath. After: that their part is done.
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
  const active = incident.status !== "RESOLVED";
  const pending = actions.start.isPending || actions.complete.isPending;
  const investigating = own?.status === "INVESTIGATING";

  let body;

  if (!own) {
    body = (
      <>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">
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
      </>
    );
  } else if (investigating) {
    body = (
      <>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-status-investigating-text">
            You are investigating
          </p>
          <p className="mt-0.5 text-sm text-fg-muted">
            Started <LocalDateTime value={own.startedAt} /> ·{" "}
            <span className="data">
              <Duration from={own.startedAt} />
            </span>{" "}
            ago. Post what you find on the timeline; completing your part does
            not resolve the incident.
          </p>
        </div>
        {active && (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => actions.complete.mutate()}
          >
            {actions.complete.isPending
              ? "Completing…"
              : "Mark my response complete"}
          </Button>
        )}
      </>
    );
  } else {
    body = (
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-status-resolved-text">
          Response complete
        </p>
        <p className="mt-0.5 text-sm text-fg-muted">
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
    );
  }

  return (
    <DetailCard
      id="your-response"
      title="Your response"
      className={cx(
        investigating && "border-l-[3px] border-l-status-investigating-text",
        own?.status === "COMPLETED" &&
          "border-status-resolved-line border-l-[3px] border-l-status-resolved-text",
        !own && "border-accent-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
        {body}
      </div>
    </DetailCard>
  );
}
