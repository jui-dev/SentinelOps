"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Lock } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { Permission } from "@/lib/api/contracts";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { TextArea } from "@/components/ui/field";
import { SubmitHint, useRequiredFields } from "@/components/ui/required";
import { Duration, formatDuration, useMinuteClock } from "@/components/ui/timestamp";
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
import { useCurrentUser } from "@/lib/auth/session-provider";

import { PeopleRow, usePeople } from "./incident-people";
import {
  resolvedMeanwhile,
  storeIncident,
  useIncidentTimeline,
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

type ResponseState = "awaiting" | "in-progress" | "complete" | "resolved";

/** Where the response stands, and its counts. */
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

  return {
    state,
    list,
    investigating,
    complete: list.length - investigating.length,
  };
};

/** When the first responder started: the moment investigation began. */
export const firstStartOf = (incident: IncidentDetailResponse) =>
  incident.responders.reduce<string | undefined>(
    (first, { startedAt }) =>
      first === undefined || Date.parse(startedAt) < Date.parse(first)
        ? startedAt
        : first,
    undefined,
  );

/**
 * A role's panel: the one emphasised surface on the incident page, with a
 * small caps title, a headline, a line beneath, and whatever the role does.
 * Teal for a member's own response, blue for oversight, quiet for a reader.
 */
export function Panel({
  id,
  title,
  headline,
  tone,
  aside,
  action,
  children,
}: {
  id: string;
  title: string;
  headline: ReactNode;
  tone: "teal" | "blue" | "amber" | "quiet";
  aside?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const headingId = useId();

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cx(
        "flex flex-col overflow-hidden rounded-2xl border",
        tone === "teal" &&
          "border-status-resolved-line bg-linear-to-b from-status-resolved-subtle to-surface",
        tone === "blue" &&
          "border-status-investigating-line bg-linear-to-b from-status-investigating-subtle to-surface",
        tone === "amber" &&
          "border-warning-line bg-linear-to-b from-warning-subtle to-surface",
        tone === "quiet" && "border-line bg-surface",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-5 pb-4 sm:px-6">
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1">
          <h2
            id={headingId}
            className={cx(
              "label-caps",
              tone === "teal" && "text-status-resolved-text",
              tone === "blue" && "text-status-investigating-text",
              tone === "amber" && "text-warning-text",
              tone === "quiet" && "text-fg-subtle",
            )}
          >
            {title}
          </h2>
          <p className="text-lg font-semibold text-fg sm:text-xl">{headline}</p>
          {aside && <div className="max-w-2xl text-sm leading-6 text-fg-muted">{aside}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Who may respond, as a small label beside a panel's headline. */
export function AccessBadge({
  tone,
  children,
}: {
  tone: "amber" | "blue";
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "ml-2.5 inline-flex h-6.5 items-center rounded-full border px-2.5 align-middle text-xs font-medium",
        tone === "amber"
          ? "border-warning-line bg-warning-subtle text-warning-text"
          : "border-status-investigating-line bg-status-investigating-subtle text-status-investigating-text",
      )}
    >
      {children}
    </span>
  );
}

/** A panel's lower band: a rule above it, and a darker ground. */
export function Band({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line-subtle bg-canvas/30 px-5 py-3.5 sm:px-6",
        className,
      )}
    >
      {children}
    </div>
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
    case ApiErrorCode.RESPONSE_NOT_OPEN:
      return "The Admin hasn't chosen who responds to this incident yet. It has been refreshed.";
    case ApiErrorCode.NOT_ASSIGNED_TO_INCIDENT:
      return "This incident is assigned to specific people, and you aren't one of them. It has been refreshed.";
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

/** The caller's own updates on the timeline: how many, and the latest. */
const useYourUpdates = (incident: IncidentResponse) => {
  const organization = useOrganization();
  const me = useCurrentUser();
  const timeline = useIncidentTimeline(organization.id, incident.number);
  const yours = (timeline.data ?? []).filter(
    ({ type, actor }) => type === "UPDATE" && actor.id === me.data?.id,
  );

  return timeline.data
    ? { count: yours.length, last: yours.at(-1)?.createdAt }
    : undefined;
};

/**
 * A member's own part, and the page's first concern for them. Before they
 * start: whether anyone is on it, Start investigating, and what the three
 * steps of a response are. While investigating: since when, the update box,
 * and completing their part. After: that it is done, and what is left to
 * whom. Their team, and where each stands, along the foot throughout.
 */
export function YourResponse({
  incident,
  own,
  actions,
  pinned = false,
}: {
  incident: IncidentDetailResponse;
  own: IncidentResponderResponse | undefined;
  actions: OwnResponse;
  /**
   * On a phone: the update box pinned to the foot of the screen while they
   * investigate, so posting is always in reach however far they scroll.
   */
  pinned?: boolean;
}) {
  const now = useMinuteClock();
  const people = usePeople(incident);
  const updates = useYourUpdates(incident);
  const { investigating } = responseStateOf(incident);
  const others = investigating.filter(
    ({ membershipId }) => membershipId !== own?.membershipId,
  );
  const active = incident.status !== "RESOLVED";
  const pending = actions.start.isPending || actions.complete.isPending;
  const assigned = incident.responseAccess === "ASSIGNED";
  const team = (
    <PeopleRow
      label={assigned ? "On this incident" : `${incident.team.name} on this`}
      people={people}
    />
  );
  const tally =
    updates &&
    `${updates.count} ${updates.count === 1 ? "update" : "updates"} from you${
      updates.last
        ? ` · last ${formatDuration(now.getTime() - Date.parse(updates.last))} ago`
        : ""
    }`;

  if (!own) {
    return (
      <Panel
        id="your-response"
        title="Your response"
        tone="teal"
        headline={
          assigned ? (
            "Assigned to you"
          ) : (
            <>
              Open to your team
              <AccessBadge tone="blue">Open to team</AccessBadge>
            </>
          )
        }
        aside={
          assigned
            ? "The Admin asked you to work on this incident. Start when you pick it up."
            : `Anyone on ${incident.team.name} can pick this up. Start when you are ready to work on it.`
        }
        action={
          <Button size="lg" disabled={pending} onClick={() => actions.start.mutate()}>
            {actions.start.isPending ? "Starting…" : "Start investigating"}
          </Button>
        }
      >
        {/* On a phone the line above says enough; the steps take the screen. */}
        <ol
          aria-label="How a response goes"
          className="hidden gap-3 px-5 pb-5 sm:grid sm:grid-cols-3 sm:px-6"
        >
          {[
            ["Start", "You're listed as investigating."],
            ["Post updates", "What you found, what you changed."],
            ["Complete your part", "The Admin resolves once no one is still on it."],
          ].map(([step, note], index) => (
            <li
              key={step}
              className="flex gap-3 rounded-lg border border-status-resolved-line/60 bg-canvas/30 px-3.5 py-3"
            >
              <span className="data font-medium text-status-resolved-text">{index + 1}</span>
              <span className="text-sm text-fg-muted">
                <span className="block font-semibold text-fg">{step}</span>
                {note}
              </span>
            </li>
          ))}
        </ol>
        <Band>{team}</Band>
      </Panel>
    );
  }

  if (own.status === "INVESTIGATING") {
    return (
      <Panel
        id="your-response"
        title="Your response"
        tone="teal"
        headline={
          <>
            You&apos;re investigating
            <span className="data ml-2 text-base font-medium text-status-investigating-text">
              · <Duration from={own.startedAt} />
            </span>
          </>
        }
        action={tally && <span className="text-sm text-fg-muted">{tally}</span>}
      >
        {active &&
          (pinned ? (
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-status-resolved-line bg-rail-top/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.3)] backdrop-blur">
              <UpdateComposer
                incident={incident}
                placeholder="What did you find or change?"
                compact
              />
            </div>
          ) : (
            <UpdateComposer
              incident={incident}
              placeholder="What did you find, what did you change, what happens next?"
              className="px-5 pb-5 sm:px-6"
            />
          ))}
        <Band>
          {team}
          {active && (
            <div className="flex flex-col items-end gap-1">
              {/* The member's finishing act: the teal of work done, with its tick. */}
              <Button
                variant="complete"
                size="lg"
                icon={CircleCheck}
                disabled={pending}
                onClick={() => actions.complete.mutate()}
              >
                {actions.complete.isPending ? "Completing…" : "Complete my response"}
              </Button>
              <span className="text-xs text-fg-subtle">
                Stops your updates. It doesn&apos;t resolve the incident.
              </span>
            </div>
          )}
        </Band>
      </Panel>
    );
  }

  return (
    <Panel
      id="your-response"
      title="Your response"
      tone="teal"
      headline={
        <span className="inline-flex items-center gap-2.5">
          <CircleCheck aria-hidden="true" strokeWidth={2} className="size-5 text-status-resolved-text" />
          You completed your part
          {own.completedAt &&
            ` ${formatDuration(now.getTime() - Date.parse(own.completedAt))} ago`}
          .
        </span>
      }
      aside={
        <>
          You investigated for{" "}
          <Duration from={own.startedAt} to={own.completedAt ?? own.startedAt} />
          {updates && ` and posted ${updates.count} ${updates.count === 1 ? "update" : "updates"}`}
          .{" "}
          {!active
            ? "The incident is resolved."
            : others.length > 0
              ? `${nameList(others.map(({ name }) => name))} ${others.length === 1 ? "is" : "are"} still investigating; the Admin resolves once no one is.`
              : "Everyone is done, so it's with the Admin to resolve."}
        </>
      }
    >
      <Band>{team}</Band>
    </Panel>
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
    <div className="border-t border-line-subtle px-5 py-4 sm:px-6">
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

/** One of oversight's four figures: a small label, then its value. */
function Figure({
  label,
  children,
  tone,
}: {
  label: string;
  children: ReactNode;
  tone?: "warning" | "resolved";
}) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3.5 sm:px-6">
      <dt className="label-caps text-fg-subtle">{label}</dt>
      <dd
        className={cx(
          "numeric text-lg font-semibold",
          tone === "warning" && "text-warning-text",
          tone === "resolved" && "text-status-resolved-text",
          !tone && "text-fg",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** Past this wait for a first responder, the wait is called out. */
export const SLOW_START_MS = 30 * 60_000;

/**
 * Oversight's panel: whether the incident can be resolved and, until it
 * can, who it waits for; resolving with how it ended, once everyone who
 * started has completed. The four figures oversight reads an incident by,
 * the responsible team and where each stands, and posting as the Admin.
 */
export function OversightPanel({
  incident,
  canManage,
}: {
  incident: IncidentDetailResponse;
  canManage: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const organization = useOrganization();
  const timeline = useIncidentTimeline(organization.id, incident.number);
  const lockId = useId();
  const { state, list, investigating, complete } = responseStateOf(incident);
  const firstStart = firstStartOf(incident);
  const wait = firstStart ? Date.parse(firstStart) - Date.parse(incident.createdAt) : undefined;
  const updates = timeline.data?.filter(({ type }) => type === "UPDATE").length;
  const ready = canManage && state === "complete";
  // Told before resolving: someone was asked to help and never began.
  const notStarted = incident.assignees.filter(
    ({ membershipId }) =>
      !list.some((responder) => responder.membershipId === membershipId),
  );
  const notStartedNote =
    notStarted.length > 0
      ? ` ${nameList(notStarted.map(({ name }) => name))} ${
          notStarted.length === 1 ? "hasn't" : "haven't"
        } started.`
      : "";
  const waitingFor = {
    PENDING: canManage ? "your decision" : "the Admin",
    OPEN: `${incident.team.name} to start`,
    ASSIGNED: `${nameList(incident.assignees.map(({ name }) => name))} to start`,
  }[incident.responseAccess];

  const headline = {
    awaiting: `Waiting for ${waitingFor}.`,
    "in-progress": "Not ready to resolve yet.",
    complete: "Everyone has completed. Ready to resolve.",
    resolved: "Resolved.",
  }[state];
  const aside = {
    awaiting:
      incident.responseAccess === "PENDING"
        ? "The response begins once you choose who responds."
        : incident.responseAccess === "ASSIGNED"
          ? "Nobody assigned has started yet."
          : `${incident.team.name} has not started investigating yet.`,
    "in-progress": `${nameList(investigating.map(({ name }) => name))} ${
      investigating.length === 1 ? "is" : "are"
    } still investigating.${notStartedNote} Resolve opens when everyone who started has completed.`,
    complete: `${responders(list.length)} completed their response.${notStartedNote} Write what was wrong and what fixed it; the note stays with the incident.`,
    resolved:
      list.length === 0
        ? "No one responded to this incident."
        : `${responders(list.length)} responded to this incident.`,
  }[state];

  return (
    <Panel
      id="response"
      title="Response and resolution"
      tone={state === "complete" || state === "resolved" ? "teal" : "blue"}
      headline={headline}
      aside={aside}
      action={
        canManage &&
        state !== "resolved" &&
        !confirming &&
        (ready ? (
          <Button size="lg" onClick={() => setConfirming(true)}>
            Resolve incident
          </Button>
        ) : (
          state === "in-progress" && (
            <div className="flex flex-col items-end gap-1">
              <Button size="lg" disabled aria-describedby={lockId}>
                <Lock aria-hidden="true" className="size-4" />
                Resolve incident
              </Button>
              <span id={lockId} className="text-xs text-fg-subtle">
                waiting on {responders(investigating.length)}
              </span>
            </div>
          )
        ))
      }
    >
      <dl
        aria-label={`${incidentKey(incident.number)} at a glance`}
        className="grid grid-cols-2 divide-line-subtle border-t border-line-subtle bg-canvas/30 sm:grid-cols-4 sm:divide-x"
      >
        <Figure
          label="First response"
          tone={wait === undefined || wait > SLOW_START_MS ? "warning" : undefined}
        >
          {wait === undefined ? "—" : formatDuration(wait)}
        </Figure>
        <Figure label="Investigating">{investigating.length}</Figure>
        <Figure label="Completed" tone={complete > 0 ? "resolved" : undefined}>
          {complete}
        </Figure>
        <Figure label="Updates">{updates ?? "—"}</Figure>
      </dl>
      {ready && confirming && (
        <ResolveForm incident={incident} onCancel={() => setConfirming(false)} />
      )}
      {canManage && state !== "resolved" && (
        <UpdateComposer
          incident={incident}
          placeholder="Context for the team, a decision, a customer note…"
          className="border-t border-line-subtle bg-canvas/20 px-5 py-4 sm:px-6"
        />
      )}
    </Panel>
  );
}

/**
 * A reader's panel — someone who follows the incident without a part in
 * it: where the response stands, and who is on it. While the Admin has not
 * chosen who responds, or has chosen other people, it says that first, so
 * nobody wonders why there is nothing for them to press.
 */
export function FollowPanel({ incident }: { incident: IncidentDetailResponse }) {
  const people = usePeople(incident);
  const { state, list, investigating, complete } = responseStateOf(incident);
  const canRespond = useCan(Permission.INCIDENTS_RESPOND);

  if (incident.status !== "RESOLVED" && incident.responseAccess === "PENDING") {
    return (
      <Panel
        id="response"
        title={canRespond ? "Your response" : "Response"}
        tone="amber"
        headline={
          <>
            Waiting for the Admin
            <AccessBadge tone="amber">Not open yet</AccessBadge>
          </>
        }
        aside={`The Admin will open this to ${incident.team.name} or assign specific people.${
          canRespond ? " You'll be told as soon as you can respond." : ""
        }`}
      >
        <Band>
          <span className="text-sm text-fg-muted">Nobody has started yet.</span>
        </Band>
      </Panel>
    );
  }

  if (incident.status !== "RESOLVED" && incident.responseAccess === "ASSIGNED") {
    const standing = (names: readonly string[], one: string, many: string) =>
      names.length > 0
        ? [`${nameList(names)} ${names.length === 1 ? one : many}.`]
        : [];
    const notStarted = incident.assignees.filter(
      ({ membershipId }) => !list.some((r) => r.membershipId === membershipId),
    );

    return (
      <Panel
        id="response"
        title="Responders"
        tone="quiet"
        headline={`Assigned to ${nameList(incident.assignees.map(({ name }) => name))}`}
        aside="You can follow this incident. The Admin can add you if you are needed."
      >
        <Band>
          <span className="text-sm text-fg-muted">
            {[
              ...standing(
                investigating.map(({ name }) => name),
                "is investigating",
                "are investigating",
              ),
              ...standing(
                list.filter(({ status }) => status === "COMPLETED").map(({ name }) => name),
                "has completed",
                "have completed",
              ),
              ...standing(
                notStarted.map(({ name }) => name),
                "hasn't started",
                "haven't started",
              ),
            ].join(" ")}
          </span>
        </Band>
      </Panel>
    );
  }

  return (
    <Panel
      id="response"
      title="Response"
      tone="quiet"
      headline={
        {
          awaiting:
            incident.responseAccess === "PENDING"
              ? "Waiting for the Admin."
              : `Waiting for ${
                  incident.responseAccess === "ASSIGNED"
                    ? "the people assigned"
                    : incident.team.name
                } to start.`,
          "in-progress": "Response in progress.",
          complete: "Everyone has completed.",
          resolved: "Resolved.",
        }[state]
      }
      aside={
        {
          awaiting:
            incident.responseAccess === "PENDING"
              ? "The Admin will choose who responds."
              : incident.responseAccess === "ASSIGNED"
                ? "Nobody assigned has started yet."
                : `${incident.team.name} has not started investigating yet.`,
          "in-progress": `${investigating.length} investigating · ${complete} complete`,
          complete: `${responders(list.length)} completed their response.`,
          resolved:
            list.length === 0
              ? "No one responded to this incident."
              : `${responders(list.length)} responded to this incident.`,
        }[state]
      }
    >
      {people.length > 0 && (
        <Band>
          <PeopleRow label={incident.team.name} people={people} />
        </Band>
      )}
    </Panel>
  );
}
