"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Flag,
  Gauge,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { TextArea } from "@/components/ui/field";
import { Section } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { LocalDateTime } from "@/components/ui/timestamp";
import { ApiErrorCode } from "@/lib/api/contracts";
import type {
  IncidentActivityResponse,
  IncidentResponse,
  IncidentSeverity,
  IncidentStatus,
} from "@/lib/api/contracts";
import { postIncidentUpdate } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { useIncidentTimeline } from "./incident-queries";
import { SeverityMark, StatusMark } from "./severity";
import type { RetiredIncidentStatus } from "./severity";

/** A status a timeline entry names: current, or retired since it was recorded. */
type RecordedStatus = IncidentStatus | RetiredIncidentStatus;

const RESOLVED_MEANWHILE =
  "This incident was resolved by someone else, so updates can no longer be posted. It has been refreshed.";

const NOT_INVESTIGATING =
  "You are not investigating this incident, so you cannot post updates to it. The incident has been refreshed.";

const RESPONSE_COMPLETE =
  "Your response to this incident is already complete, so you cannot post more updates. The incident has been refreshed.";

/** What a recorded change says, in one line. Updates carry their own text. */
function describe(entry: IncidentActivityResponse): ReactNode {
  switch (entry.type) {
    case "DECLARED":
      return (
        <>
          Declared the incident
          {entry.toValue && (
            <>
              {" at "}
              <SeverityMark severity={entry.toValue as IncidentSeverity} />
            </>
          )}
        </>
      );
    case "SEVERITY_CHANGED":
      return (
        <>
          Changed severity{" "}
          <SeverityMark severity={entry.fromValue as IncidentSeverity} />
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <SeverityMark severity={entry.toValue as IncidentSeverity} />
        </>
      );
    case "TEAM_CHANGED":
      return (
        <>
          Reassigned the incident from{" "}
          <span className="font-medium text-fg">{entry.fromValue}</span> to{" "}
          <span className="font-medium text-fg">{entry.toValue}</span>
        </>
      );
    case "STATUS_CHANGED":
      if (entry.toValue === "RESOLVED") {
        return (
          <>
            <StatusMark status="RESOLVED" className="font-semibold text-fg" />{" "}
            the incident
          </>
        );
      }
      // Recorded when the first responder started investigating, just after
      // their own entry — so it says what happened to the incident, not
      // what they did again.
      if (entry.fromValue === "DECLARED" && entry.toValue === "INVESTIGATING") {
        return (
          <>
            The incident is now{" "}
            <StatusMark status="INVESTIGATING" className="font-medium text-fg" />
          </>
        );
      }
      // Any other change was recorded before the lifecycle was simplified,
      // and can name a retired status: shown as it was.
      return (
        <>
          Changed status{" "}
          <StatusMark status={entry.fromValue as RecordedStatus} />
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <StatusMark
            status={entry.toValue as RecordedStatus}
            className="font-medium text-fg"
          />
        </>
      );
    default:
      return null;
  }
}

/**
 * What the actor did, said after their name, for the entries whose whole
 * story that is: a response starting or completing. Updates say it too, and
 * carry their text beneath.
 */
const ACTIONS: Partial<Record<IncidentActivityResponse["type"], string>> = {
  UPDATE: "posted an update",
  RESPONSE_STARTED: "started investigating",
  RESPONSE_COMPLETED: "completed their response",
};

/**
 * The rail's marker for a recorded event: an icon per kind, so a start, a
 * completion, and a lifecycle change are told apart at a glance. Colour only
 * where it means what it means elsewhere: the accent for a response under
 * way, nominal green for completion and resolution.
 */
const eventMarker = (
  entry: IncidentActivityResponse,
): { Icon: LucideIcon; colour: string } => {
  switch (entry.type) {
    case "DECLARED":
      return { Icon: Flag, colour: "text-fg-muted" };
    case "SEVERITY_CHANGED":
      return { Icon: Gauge, colour: "text-fg-muted" };
    case "TEAM_CHANGED":
      return { Icon: ArrowLeftRight, colour: "text-fg-muted" };
    case "RESPONSE_STARTED":
      return { Icon: CircleDot, colour: "text-accent-text" };
    case "RESPONSE_COMPLETED":
      return { Icon: CircleCheck, colour: "text-signal-nominal" };
    default:
      return entry.toValue === "RESOLVED"
        ? { Icon: CircleCheck, colour: "text-signal-nominal" }
        : { Icon: CircleDashed, colour: "text-fg-muted" };
  }
};

/** Up to two initials, for a person's marker on the rail. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

/**
 * One entry. A person's update is the timeline's content: their initials on
 * the rail, and their words in a block of readable text. Everything the
 * server recorded — declaring, responses starting and completing, changes —
 * is a compact line with an icon, quieter than what people wrote.
 */
function TimelineEntry({ entry }: { entry: IncidentActivityResponse }) {
  const update = entry.type === "UPDATE";
  const action = ACTIONS[entry.type];

  if (update) {
    return (
      <li className="relative pb-6 pl-8 last:pb-0">
        <span
          aria-hidden="true"
          className="absolute top-0 -left-3 grid size-6 place-items-center rounded-full border border-accent-line bg-accent-subtle text-[0.625rem] font-semibold text-accent-text"
        >
          {initials(entry.actor.name)}
        </span>
        <p className="text-sm text-fg-muted">
          <span className="font-semibold text-fg">{entry.actor.name}</span>
          <span> {action}</span> ·{" "}
          <span className="text-xs">
            <LocalDateTime value={entry.createdAt} />
          </span>
        </p>
        <p className="mt-1.5 max-w-2xl rounded-r-md border-l-2 border-accent-line bg-surface px-3.5 py-2.5 text-sm leading-6 whitespace-pre-line text-fg">
          {entry.message}
        </p>
      </li>
    );
  }

  const { Icon, colour } = eventMarker(entry);
  // The resolution's note: kept with its entry, in the success rule that
  // completion and resolution share.
  const note =
    entry.type === "STATUS_CHANGED" && entry.toValue === "RESOLVED"
      ? entry.message
      : null;

  return (
    <li className="relative pb-4 pl-8 last:pb-0">
      <span
        aria-hidden="true"
        className="absolute top-0 -left-2.5 grid size-5 place-items-center rounded-full border border-line-subtle bg-canvas"
      >
        <Icon strokeWidth={2} className={cx("size-3", colour)} />
      </span>
      <p className="text-xs text-fg-muted">
        <span className="font-medium text-fg">{entry.actor.name}</span>
        {action && <span className="text-fg"> {action}</span>} ·{" "}
        <LocalDateTime value={entry.createdAt} />
      </p>
      {!action && (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
          {describe(entry)}
        </p>
      )}
      {note && (
        <p className="mt-1.5 max-w-2xl rounded-r-md border-l-2 border-success-line bg-surface px-3.5 py-2.5 text-sm leading-6 whitespace-pre-line text-fg">
          {note}
        </p>
      )}
    </li>
  );
}

/** The caller's own response no longer allows posting. */
const responseClosed = (error: unknown) =>
  (isApiError(error, 403) &&
    error.code === ApiErrorCode.START_INVESTIGATING_FIRST) ||
  (isApiError(error, 409) &&
    error.code === ApiErrorCode.RESPONSE_ALREADY_COMPLETED);

/** Posting a short operational update. Cleared once it is on the timeline. */
export function UpdateComposer({
  incident,
  hint = "What responders know now, and what they are doing about it.",
}: {
  incident: IncidentResponse;
  hint?: string;
}) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");

  const post = useMutation({
    mutationFn: (text: string) =>
      postIncidentUpdate(organization.id, incident.number, { message: text }),
    onSuccess: () => {
      setMessage("");
      // The incident's entry and, beneath it, its timeline: posting also
      // moves the incident's last-changed time.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.incident(organization.id, incident.number),
      });
    },
    onError: (error) => {
      // Resolved, gone, or the caller's own response changed since the page
      // loaded: the incident is fetched again, which takes the composer away.
      if (
        isApiError(error, 404) ||
        isApiError(error, 409) ||
        responseClosed(error)
      ) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.incidents(organization.id),
        });
      }
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    post.mutate(message);
  };

  const fields = fieldErrorsOf(post.error);
  const resolvedMeanwhile =
    isApiError(post.error, 409) &&
    post.error.code === ApiErrorCode.INCIDENT_RESOLVED;
  const errorMessage = resolvedMeanwhile
    ? RESOLVED_MEANWHILE
    : responseClosed(post.error)
      ? isApiError(post.error, 409)
        ? RESPONSE_COMPLETE
        : NOT_INVESTIGATING
      : undefined;

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-3">
      {post.isError && Object.keys(fields).length === 0 && (
        <ErrorAlert error={post.error} message={errorMessage} />
      )}
      <TextArea
        label="Post an update"
        name="message"
        rows={3}
        maxLength={2000}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        hint={hint}
        error={fields.message}
      />
      <div>
        <Button
          type="submit"
          disabled={message.trim() === "" || post.isPending}
        >
          {post.isPending ? "Posting…" : "Post update"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The operational story of the incident, oldest first: human updates,
 * responses starting and completing, and the declaration, severity, status,
 * and team changes the server recorded. History only — where the response
 * stands now is the incident's responders, shown above it. `canPost` puts the
 * update composer beneath it — for the Admin; a responder posts from their
 * own response panel instead.
 */
export function IncidentTimeline({
  incident,
  canPost,
}: {
  incident: IncidentResponse;
  canPost: boolean;
}) {
  const organization = useOrganization();
  const timeline = useIncidentTimeline(organization.id, incident.number);

  return (
    <Section
      id="timeline"
      title="Timeline"
      meta={timeline.data?.length}
      description="Updates from responders and changes to the incident, oldest first."
    >
      {timeline.isError ? (
        <ErrorAlert error={timeline.error} />
      ) : !timeline.data ? (
        <Spinner label="Loading timeline…" />
      ) : timeline.data.length === 0 ? (
        <p className="text-sm text-fg-muted">No activity recorded yet.</p>
      ) : (
        <ol className="mt-1 ml-3 border-l border-line-subtle">
          {timeline.data.map((entry) => (
            <TimelineEntry key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
      {canPost && <UpdateComposer incident={incident} />}
    </Section>
  );
}
