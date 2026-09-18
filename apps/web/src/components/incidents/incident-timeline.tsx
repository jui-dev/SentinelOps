"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

const RESOLVED_MEANWHILE =
  "This incident was resolved by someone else, so updates can no longer be posted. It has been refreshed.";

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
    case "STATUS_CHANGED":
      return entry.toValue === "RESOLVED" ? (
        <>
          <StatusMark status="RESOLVED" className="font-semibold text-fg" />{" "}
          the incident
        </>
      ) : (
        <>
          Changed status{" "}
          <StatusMark status={entry.fromValue as IncidentStatus} />
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <StatusMark
            status={entry.toValue as IncidentStatus}
            className="font-medium text-fg"
          />
        </>
      );
    default:
      return null;
  }
}

function TimelineEntry({ entry }: { entry: IncidentActivityResponse }) {
  const update = entry.type === "UPDATE";

  return (
    <li className="relative pb-5 pl-6 last:pb-0">
      {/* The rail's dot: solid for a human update, hollow for a change. */}
      <span
        aria-hidden="true"
        className={
          update
            ? "absolute top-1.5 -left-1.25 size-2.5 rounded-full bg-accent"
            : "absolute top-1.5 -left-1.25 size-2.5 rounded-full border-2 border-line-strong bg-canvas"
        }
      />
      <p className="text-xs text-fg-muted">
        <span className="font-medium text-fg">{entry.actor.name}</span>
        {update ? " posted an update" : ""} ·{" "}
        <LocalDateTime value={entry.createdAt} />
      </p>
      {update ? (
        <p className="mt-1.5 max-w-2xl rounded-md border border-line-subtle px-3 py-2 text-sm whitespace-pre-line text-fg">
          {entry.message}
        </p>
      ) : (
        <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
          {describe(entry)}
        </p>
      )}
    </li>
  );
}

/** Posting a short operational update. Cleared once it is on the timeline. */
function UpdateComposer({ incident }: { incident: IncidentResponse }) {
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
      if (isApiError(error, 404) || isApiError(error, 409)) {
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

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-3">
      {post.isError && Object.keys(fields).length === 0 && (
        <ErrorAlert
          error={post.error}
          message={resolvedMeanwhile ? RESOLVED_MEANWHILE : undefined}
        />
      )}
      <TextArea
        label="Post an update"
        name="message"
        rows={3}
        maxLength={2000}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        hint="What responders know now, and what they are doing about it."
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
 * The operational story of the incident, oldest first: human updates, and the
 * declaration, severity, and status changes the server recorded. History
 * only — the record above says where the incident stands now. Updates can be
 * posted while it is active, by those who may respond.
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
        <ol className="ml-1.5 border-l border-line-subtle">
          {timeline.data.map((entry) => (
            <TimelineEntry key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
      {canPost && <UpdateComposer incident={incident} />}
    </Section>
  );
}
