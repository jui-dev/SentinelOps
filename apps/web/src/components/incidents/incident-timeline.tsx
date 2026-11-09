"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { DetailCard } from "@/components/ui/detail-layout";
import { TextArea } from "@/components/ui/field";
import { SubmitHint, useRequiredFields } from "@/components/ui/required";
import { Spinner } from "@/components/ui/spinner";
import {
  formatDuration,
  LocalTime,
  useMinuteClock,
} from "@/components/ui/timestamp";
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
import { useCurrentUser } from "@/lib/auth/session-provider";

import { EVENT_MARKERS } from "./event-markers";
import type { EventMarker } from "./event-markers";
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
          declared the incident
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
          changed severity{" "}
          <SeverityMark severity={entry.fromValue as IncidentSeverity} />
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <SeverityMark severity={entry.toValue as IncidentSeverity} />
        </>
      );
    case "TEAM_CHANGED":
      return (
        <>
          reassigned the incident from{" "}
          <span className="font-medium text-fg">{entry.fromValue}</span> to{" "}
          <span className="font-medium text-fg">{entry.toValue}</span>
        </>
      );
    case "STATUS_CHANGED":
      if (entry.toValue === "RESOLVED") {
        return (
          <>
            <StatusMark
              status="RESOLVED"
              variant="inline"
              className="font-semibold text-fg"
            />{" "}
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
            moved the incident to{" "}
            <StatusMark
              status="INVESTIGATING"
              variant="inline"
              className="font-medium text-fg"
            />
          </>
        );
      }
      // Any other change was recorded before the lifecycle was simplified,
      // and can name a retired status: shown as it was.
      return (
        <>
          changed status{" "}
          <StatusMark
            status={entry.fromValue as RecordedStatus}
            variant="inline"
          />
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <StatusMark
            status={entry.toValue as RecordedStatus}
            variant="inline"
            className="font-medium text-fg"
          />
        </>
      );
    case "UPDATE":
      return "posted an update";
    case "RESPONSE_STARTED":
      return "started investigating";
    case "RESPONSE_COMPLETED":
      return "completed their response";
    default:
      return null;
  }
}

/** The rail's marker for an entry, from the shared vocabulary. */
const eventMarker = (entry: IncidentActivityResponse): EventMarker | undefined => {
  switch (entry.type) {
    case "UPDATE":
      return undefined;
    case "DECLARED":
      return EVENT_MARKERS.declared;
    case "SEVERITY_CHANGED":
      return EVENT_MARKERS.severityChanged;
    case "TEAM_CHANGED":
      return EVENT_MARKERS.teamChanged;
    case "RESPONSE_STARTED":
      return EVENT_MARKERS.responseStarted;
    case "RESPONSE_COMPLETED":
      return EVENT_MARKERS.responseCompleted;
    default:
      return entry.toValue === "RESOLVED"
        ? EVENT_MARKERS.resolved
        : EVENT_MARKERS.statusChanged;
  }
};

/** What people wrote: an update, or the note a resolution was made with. */
const writtenText = (entry: IncidentActivityResponse) =>
  entry.type === "UPDATE" ||
  (entry.type === "STATUS_CHANGED" && entry.toValue === "RESOLVED")
    ? entry.message
    : null;

/**
 * One entry, as a row on the rail: when, on the left — the time, and how
 * long ago — then a dot in the event's colour, then who did what. What
 * people wrote sits beneath in a quiet block: an update's text, or the note
 * the incident was resolved with.
 */
function TimelineEntry({
  entry,
  now,
  fresh,
}: {
  entry: IncidentActivityResponse;
  now: Date;
  /** Added by someone else since the page was opened. */
  fresh: boolean;
}) {
  const marker = eventMarker(entry);
  const text = writtenText(entry);
  const resolution = entry.type === "STATUS_CHANGED" && entry.toValue === "RESOLVED";

  return (
    <li
      className={cx(
        "grid grid-cols-[4.5rem_1.25rem_minmax(0,1fr)] gap-x-3",
        fresh && "-mx-4 bg-accent-subtle/50 px-4 sm:-mx-5 sm:px-5",
      )}
    >
      <span className="flex flex-col pt-3 text-xs">
        <span className="data text-fg-muted">
          <LocalTime value={entry.createdAt} />
        </span>
        <span className="text-fg-subtle">
          {formatDuration(now.getTime() - Date.parse(entry.createdAt))} ago
        </span>
      </span>
      <span aria-hidden="true" className="relative flex justify-center">
        <span className="absolute inset-y-0 w-0.5 bg-line-subtle" />
        <span
          className={cx(
            "relative mt-4 size-2.5 rounded-full bg-current ring-3 ring-surface",
            marker ? marker.colour : "text-accent-text",
          )}
        />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 py-3">
        <p className="flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
          {fresh && (
            <span className="mr-1 rounded-sm border border-accent-line bg-accent-subtle px-1.5 text-xs font-semibold text-accent-text">
              New
            </span>
          )}
          <span className="font-semibold text-fg">{entry.actor.name}</span>{" "}
          {describe(entry)}
        </p>
        {text && (
          <p
            className={cx(
              "max-w-3xl rounded-md border px-3 py-2 text-sm leading-6 whitespace-pre-line text-fg",
              resolution
                ? "border-status-resolved-line bg-status-resolved-subtle"
                : "border-line-subtle bg-sunken/60",
            )}
          >
            {text}
          </p>
        )}
      </div>
    </li>
  );
}

/** "Today", "Yesterday", or the date: the heading over one day's entries. */
const dayLabel = (iso: string, now: Date) => {
  const day = new Date(iso);
  const yesterday = new Date(now);

  yesterday.setDate(now.getDate() - 1);

  if (day.toDateString() === now.toDateString()) return "Today";
  if (day.toDateString() === yesterday.toDateString()) return "Yesterday";

  return day.toLocaleDateString(undefined, { dateStyle: "medium" });
};

/** Entries, newest first, in runs of one local day each. */
const byDay = (entries: readonly IncidentActivityResponse[]) => {
  const days: { key: string; entries: IncidentActivityResponse[] }[] = [];

  for (const entry of [...entries].reverse()) {
    const key = new Date(entry.createdAt).toDateString();
    const last = days.at(-1);

    if (last?.key === key) last.entries.push(entry);
    else days.push({ key, entries: [entry] });
  }

  return days;
};

/** The caller's own response no longer allows posting. */
const responseClosed = (error: unknown) =>
  (isApiError(error, 403) &&
    error.code === ApiErrorCode.START_INVESTIGATING_FIRST) ||
  (isApiError(error, 409) &&
    error.code === ApiErrorCode.RESPONSE_ALREADY_COMPLETED);

/** Posting a short operational update. Cleared once it is on the timeline. */
export function UpdateComposer({ incident }: { incident: IncidentResponse }) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const { attach: requiredRef, ...required } = useRequiredFields(message);

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
    if (message.trim() === "" || post.isPending) return;
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
  const blank = message.trim() === "";

  return (
    <form
      ref={requiredRef}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-2 border-b border-line-subtle px-4 py-4 sm:px-5"
    >
      {post.isError && Object.keys(fields).length === 0 && (
        <ErrorAlert error={post.error} message={errorMessage} />
      )}
      <TextArea
        label="Post an update"
        name="message"
        required
        rows={2}
        maxLength={2000}
        value={message}
        placeholder="What changed, what is being tried, what is next."
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          // Ctrl+Enter (or ⌘+Enter) posts, as in most chat and ticket tools.
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        error={fields.message}
      />
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        <span className="mr-auto text-xs text-fg-subtle">
          <kbd className="data rounded-sm border border-line px-1">Ctrl</kbd> +{" "}
          <kbd className="data rounded-sm border border-line px-1">Enter</kbd>{" "}
          to post
        </span>
        <SubmitHint id={required.hintId} missing={required.missing} />
        <Button
          type="submit"
          size="sm"
          disabled={blank || post.isPending}
          aria-describedby={blank ? required.hintId : undefined}
        >
          {post.isPending ? "Posting…" : "Post update"}
        </Button>
      </div>
    </form>
  );
}

type Show = "updates" | "everything";

/** Updates only, or everything recorded: two pressed-state buttons. */
function ShowToggle({
  show,
  onChange,
  counts,
}: {
  show: Show;
  onChange: (show: Show) => void;
  counts: Record<Show, number>;
}) {
  return (
    <div
      role="group"
      aria-label="Show"
      className="inline-flex overflow-hidden rounded-md border border-line-strong text-xs"
    >
      {(["updates", "everything"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={show === value}
          onClick={() => onChange(value)}
          className={cx(
            "px-2.5 py-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
            show === value
              ? "bg-accent font-semibold text-on-accent"
              : "bg-surface text-fg-muted hover:text-fg",
          )}
        >
          {value === "updates" ? "Updates" : "Everything"}{" "}
          <span className="numeric opacity-70">{counts[value]}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The operational story of the incident, newest first and by day: updates
 * people posted, responses starting and completing, and the declaration,
 * severity, status, and team changes the server recorded. History only —
 * where the response stands now is the Response card above it. `canPost`
 * puts the update composer at its head: for the Admin, and for a member
 * while they are investigating.
 */
export function IncidentTimeline({
  incident,
  canPost,
}: {
  incident: IncidentResponse;
  canPost: boolean;
}) {
  const organization = useOrganization();
  const me = useCurrentUser();
  const timeline = useIncidentTimeline(organization.id, incident.number, {
    live: incident.status !== "RESOLVED",
  });
  const now = useMinuteClock();
  const [show, setShow] = useState<Show>("everything");
  // What was there when the page opened, and what the caller has since been
  // shown: entries others added after it are new, until they look.
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  if (timeline.data && seen === null) {
    setSeen(new Set(timeline.data.map(({ id }) => id)));
  }

  const all = timeline.data ?? [];
  const fresh = new Set(
    seen === null
      ? []
      : all
          .filter(({ id, actor }) => !seen.has(id) && actor.id !== me.data?.id)
          .map(({ id }) => id),
  );
  const unread = all.filter(({ id }) => fresh.has(id) && !acknowledged.has(id));
  const unreadUpdates = unread.filter(({ type }) => type === "UPDATE").length;
  const newLabel =
    unreadUpdates === unread.length
      ? `${unread.length} new ${unread.length === 1 ? "update" : "updates"}`
      : `${unread.length} new ${unread.length === 1 ? "entry" : "entries"}`;

  const updates = all.filter((entry) => entry.type === "UPDATE");
  const shown = show === "updates" ? updates : all;

  let content;

  if (timeline.isError) {
    content = (
      <div className="p-4 sm:px-5">
        <ErrorAlert error={timeline.error} />
      </div>
    );
  } else if (!timeline.data) {
    content = <Spinner label="Loading timeline…" />;
  } else if (shown.length === 0) {
    content = (
      <p className="px-4 py-4 text-sm text-fg-muted sm:px-5">
        {show === "updates" && all.length > 0
          ? "No updates posted yet."
          : "No activity recorded yet."}
      </p>
    );
  } else {
    content = byDay(shown).map((day) => (
      <section key={day.key} aria-label={dayLabel(day.entries[0].createdAt, now)}>
        <p className="label-caps border-b border-line-subtle bg-sunken/40 px-4 py-2 text-fg-subtle sm:px-5">
          {dayLabel(day.entries[0].createdAt, now)}
        </p>
        <ol className="px-4 pb-2 sm:px-5">
          {day.entries.map((entry) => (
            <TimelineEntry
              key={entry.id}
              entry={entry}
              now={now}
              fresh={fresh.has(entry.id)}
            />
          ))}
        </ol>
      </section>
    ));
  }

  return (
    <DetailCard
      id="timeline"
      title="Timeline"
      meta={timeline.data?.length}
      action={
        timeline.data &&
        timeline.data.length > 0 && (
          <span className="flex flex-wrap items-center gap-2">
            {unread.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAcknowledged(new Set(unread.map(({ id }) => id)));
                  if (unreadUpdates < unread.length) setShow("everything");
                  document
                    .getElementById("timeline")
                    ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                }}
                className="inline-flex items-center gap-1 rounded-full bg-accent-text px-3 py-0.5 text-xs font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {newLabel}
                <ArrowUp aria-hidden="true" className="size-3" />
              </button>
            )}
            <ShowToggle
              show={show}
              onChange={setShow}
              counts={{ updates: updates.length, everything: all.length }}
            />
          </span>
        )
      }
    >
      {canPost && <UpdateComposer incident={incident} />}
      {content}
    </DetailCard>
  );
}
