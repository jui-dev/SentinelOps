"use client";

import { FormerMember } from "@/components/organizations/former-member";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Send,
} from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { roleMeta } from "@/components/roles/role-meta";
import { cx } from "@/components/ui/cx";
import { FilterGroup, FilterOption } from "@/components/ui/filter-bar";
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
import { Avatar } from "./incident-people";
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
function describe(
  entry: IncidentActivityResponse,
  /** The caller's own entry, said as "You …": "your", not "their". */
  mine = false,
): ReactNode {
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
    case "SEVERITY_CONFIRMED":
      // The suggestion kept, or settled at another severity.
      return entry.fromValue === entry.toValue ? (
        <>
          confirmed the suggested severity{" "}
          <SeverityMark severity={entry.toValue as IncidentSeverity} />
        </>
      ) : (
        <>
          confirmed severity{" "}
          <SeverityMark severity={entry.fromValue as IncidentSeverity} />
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <SeverityMark severity={entry.toValue as IncidentSeverity} />
          <span className="text-fg-subtle"> (suggested {entry.fromValue})</span>
        </>
      );
    case "RESPONSE_ACCESS_CHANGED":
      return entry.toValue === "OPEN" ? (
        <>opened the incident to the responsible team</>
      ) : entry.toValue === "ASSIGNED" ? (
        <>
          assigned <span className="font-medium text-fg">{entry.message}</span> to respond
        </>
      ) : (
        <>removed everyone assigned, so who responds is undecided</>
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
      return mine ? "completed your response" : "completed their response";
    default:
      return null;
  }
}

/**
 * Who acted, and their role here now, in its colour: who raised, decided,
 * or worked the incident, read at a glance down the timeline. Someone the
 * Admin has removed since has no role, and is marked Former member.
 */
function Actor({
  entry,
  mine,
}: {
  entry: IncidentActivityResponse;
  mine: boolean;
}) {
  const role = entry.actor.role;
  const meta = role ? roleMeta(role) : undefined;

  return (
    <>
      <span className="font-semibold text-fg">{mine ? "You" : entry.actor.name}</span>
      {role === null && (
        <>
          <span className="sr-only">, </span>
          <FormerMember className="ml-1.5 align-middle" />
        </>
      )}
      {meta && (
        <span className={cx("text-xs font-medium", meta.tone.text)}>
          <span aria-hidden="true" className="text-fg-subtle">
            {" · "}
          </span>
          <span className="sr-only">, </span>
          {meta.label}
        </span>
      )}
    </>
  );
}

/** The rail's marker for an entry, from the shared vocabulary. */
const eventMarker = (entry: IncidentActivityResponse): EventMarker | undefined => {
  switch (entry.type) {
    case "UPDATE":
      return undefined;
    case "DECLARED":
      return EVENT_MARKERS.declared;
    case "SEVERITY_CHANGED":
    case "SEVERITY_CONFIRMED":
      return EVENT_MARKERS.severityChanged;
    case "TEAM_CHANGED":
    case "RESPONSE_ACCESS_CHANGED":
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

/** When an entry happened: its time, and how long ago, at the row's end. */
function When({ at, now }: { at: string; now: Date }) {
  return (
    <span className="data shrink-0 text-xs text-fg-subtle">
      <LocalTime value={at} /> · {formatDuration(now.getTime() - Date.parse(at))} ago
    </span>
  );
}

function NewTag() {
  return (
    <span className="mr-1 rounded-sm border border-accent-line bg-accent-subtle px-1.5 text-xs font-semibold text-accent-text">
      New
    </span>
  );
}

/**
 * One entry on the rail. An update reads as a message: the poster's
 * initials on the rail, and a card with who, when, and what they wrote —
 * the caller's own in teal, so their part is easy to find. Everything else
 * the server recorded is a quiet line: its marker on the rail, who did what,
 * and when, with the note beneath when the incident was resolved with one.
 */
function TimelineEntry({
  entry,
  now,
  fresh,
  mine,
}: {
  entry: IncidentActivityResponse;
  now: Date;
  /** Added by someone else since the page was opened. */
  fresh: boolean;
  /** Posted or done by the caller. */
  mine: boolean;
}) {
  const marker = eventMarker(entry);
  const text = writtenText(entry);
  const resolution = entry.type === "STATUS_CHANGED" && entry.toValue === "RESOLVED";

  if (entry.type === "UPDATE") {
    return (
      <li className="relative grid grid-cols-[1.875rem_minmax(0,1fr)] gap-x-3.5 py-2">
        <Avatar name={entry.actor.name} tone={mine ? "complete" : "investigating"} />
        <div
          className={cx(
            "flex min-w-0 flex-col gap-1.5 rounded-lg border px-4 py-3",
            mine
              ? "border-status-resolved-line bg-status-resolved-subtle/60"
              : "border-line bg-surface",
            fresh && "ring-2 ring-accent-line",
          )}
        >
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm text-fg-muted">
            <span>
              {fresh && <NewTag />}
              <Actor entry={entry} mine={mine} /> posted an update
            </span>
            <When at={entry.createdAt} now={now} />
          </p>
          <p className="text-[0.9375rem] leading-6 whitespace-pre-line text-fg">{text}</p>
        </div>
      </li>
    );
  }

  const Icon = marker?.Icon;

  return (
    <li className="relative grid grid-cols-[1.875rem_minmax(0,1fr)] gap-x-3.5 py-1.5">
      <span aria-hidden="true" className="flex justify-center pt-0.5">
        <span
          className={cx(
            "grid size-5.5 place-items-center rounded-full border border-line bg-rail-mid",
            marker?.colour,
          )}
        >
          {Icon && <Icon strokeWidth={2.25} className="size-3" />}
        </span>
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm text-fg-muted">
          <span className="inline-flex flex-wrap items-center gap-x-1">
            {fresh && <NewTag />}
            <Actor entry={entry} mine={mine} /> {describe(entry, mine)}
          </span>
          <When at={entry.createdAt} now={now} />
        </p>
        {text && (
          <p
            className={cx(
              "max-w-3xl rounded-lg border px-4 py-3 text-sm leading-6 whitespace-pre-line text-fg",
              resolution
                ? "border-status-resolved-line bg-status-resolved-subtle"
                : "border-line bg-surface",
            )}
          >
            {text}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Between two days far apart, one marker for the silence instead of the
 * empty stretch: amber while nobody had started yet, quiet after.
 */
function QuietGap({ days, waiting }: { days: number; waiting: boolean }) {
  return (
    <div className="grid grid-cols-[1.875rem_minmax(0,1fr)] gap-x-3.5 py-3">
      <span aria-hidden="true" className="flex justify-center">
        <span className="mt-2 size-1.5 rounded-full bg-line-strong" />
      </span>
      <p
        className={cx(
          "w-max rounded-full border px-3 py-1 text-xs",
          waiting
            ? "border-warning-line bg-warning-subtle text-warning-text"
            : "border-line bg-surface text-fg-muted",
        )}
      >
        {days} {days === 1 ? "day" : "days"} {waiting ? "with no response" : "quiet"}
      </p>
    </div>
  );
}

const DAY_MS = 86_400_000;

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

/**
 * Posting a short operational update. Cleared once it is on the timeline.
 * It sits in the caller's panel — a member's response, or the Admin's —
 * with what to write about said in its placeholder.
 */
export function UpdateComposer({
  incident,
  placeholder = "What changed, what is being tried, what is next.",
  className,
  compact = false,
}: {
  incident: IncidentResponse;
  placeholder?: string;
  className?: string;
  /** Two lines, for a bar pinned to a phone's screen. */
  compact?: boolean;
}) {
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
      className={cx("flex flex-col gap-2", className)}
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
        placeholder={placeholder}
        className={compact ? "min-h-16!" : undefined}
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
        <span className="mr-auto hidden text-xs text-fg-subtle sm:inline">
          <kbd className="data rounded-sm border border-line px-1">Ctrl</kbd> +{" "}
          <kbd className="data rounded-sm border border-line px-1">Enter</kbd>{" "}
          to post
        </span>
        <SubmitHint id={required.hintId} missing={required.missing} />
        <Button icon={Send}
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
    <FilterGroup label="Show" showLabel={false}>
      {(["updates", "everything"] as const).map((value) => (
        <FilterOption
          key={value}
          pressed={show === value}
          onClick={() => onChange(value)}
          count={counts[value]}
        >
          {value === "updates" ? "Updates" : "Everything"}
        </FilterOption>
      ))}
    </FilterGroup>
  );
}

/**
 * The operational story of the incident, newest first and by day: updates
 * people posted, responses starting and completing, and the declaration,
 * severity, status, and team changes the server recorded. History only —
 * where the response stands now, and posting to it, are the panel above.
 *
 * Drawn in a dark panel of its own, under a header band tinted for whose
 * reading it is: teal for a member's, blue for oversight. Days far apart are
 * joined by one marker for the silence. It opens on the updates when the
 * reader is working the incident and there are any; on everything
 * otherwise.
 */
export function IncidentTimeline({
  incident,
  tone,
  preferUpdates = false,
}: {
  incident: IncidentResponse;
  tone: "member" | "oversight";
  /** Open on the updates, when there are any: for those working it. */
  preferUpdates?: boolean;
}) {
  const organization = useOrganization();
  const me = useCurrentUser();
  const timeline = useIncidentTimeline(organization.id, incident.number, {
    live: incident.status !== "RESOLVED",
  });
  const now = useMinuteClock();
  const [chosen, setShow] = useState<Show | null>(null);
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
  const show: Show =
    chosen ?? (preferUpdates && updates.length > 0 ? "updates" : "everything");
  const shown = show === "updates" ? updates : all;
  // The first start, from everything recorded: before it, silence was a wait.
  const firstStart = all.find(({ type }) => type === "RESPONSE_STARTED")?.createdAt;

  let content;

  if (timeline.isError) {
    content = (
      <div className="py-4">
        <ErrorAlert error={timeline.error} />
      </div>
    );
  } else if (!timeline.data) {
    content = <Spinner label="Loading timeline…" />;
  } else if (shown.length === 0) {
    content = (
      <p className="py-6 text-center text-sm text-fg-muted">
        {show === "updates" && all.length > 0
          ? "No updates posted yet."
          : "No activity recorded yet."}
      </p>
    );
  } else {
    const days = byDay(shown);

    content = days.map((day, index) => {
      // The quiet between this day and the one before it, read newest first.
      const older = days[index + 1]?.entries[0];
      const newest = day.entries.at(-1)!;
      const gap = older ? Date.parse(newest.createdAt) - Date.parse(older.createdAt) : 0;
      const label = dayLabel(day.entries[0].createdAt, now);

      return (
        <div key={day.key}>
          <section aria-label={label}>
            <p className="label-caps flex items-center gap-3 pt-5 pb-2 text-fg-subtle">
              <span aria-hidden="true" className="w-7.5 shrink-0" />
              {label}
            </p>
            <ol className="relative">
              <span
                aria-hidden="true"
                className="absolute top-3 bottom-3 left-[0.875rem] w-0.5 rounded-full bg-line-subtle"
              />
              {day.entries.map((entry) => (
                <TimelineEntry
                  key={entry.id}
                  entry={entry}
                  now={now}
                  fresh={fresh.has(entry.id)}
                  mine={entry.actor.id === me.data?.id}
                />
              ))}
            </ol>
          </section>
          {gap >= DAY_MS && (
            <QuietGap
              days={Math.floor(gap / DAY_MS)}
              waiting={!firstStart || Date.parse(older!.createdAt) < Date.parse(firstStart)}
            />
          )}
        </div>
      );
    });
  }

  return (
    <section
      id="timeline"
      aria-labelledby="timeline-title"
      className="overflow-hidden rounded-lg border border-line-subtle bg-linear-to-b from-rail-top to-rail-mid shadow-[0_16px_40px_rgb(0_0_0/0.28),inset_0_1px_0_rgb(255_255_255/0.03)]"
    >
      <div
        className={cx(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-3.5 sm:px-6",
          tone === "member"
            ? "bg-linear-to-r from-status-resolved-subtle via-status-investigating-subtle/40 to-transparent"
            : "bg-linear-to-r from-status-investigating-subtle via-status-investigating-subtle/30 to-transparent",
        )}
      >
        <h2 id="timeline-title" className="flex items-baseline gap-2 text-lg font-semibold text-fg">
          Timeline
          {timeline.data && (
            <span className="numeric text-sm font-normal text-fg-muted">
              {timeline.data.length}
              <span className="sr-only"> entries</span>
            </span>
          )}
          <span className="text-xs font-normal text-fg-subtle">newest first</span>
        </h2>
        {timeline.data && timeline.data.length > 0 && (
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
        )}
      </div>
      <div className="px-4 pb-5 sm:px-6">{content}</div>
    </section>
  );
}
