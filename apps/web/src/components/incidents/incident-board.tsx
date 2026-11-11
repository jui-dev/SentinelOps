"use client";

import { ChevronRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { PeekColumn, PeekEmpty } from "@/components/teams/team-peek";
import { useTeamMembers } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { rowActionClasses } from "@/components/ui/row-action";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  Duration,
  formatDuration,
  IsoDate,
  useMinuteClock,
} from "@/components/ui/timestamp";
import type {
  IncidentListItemResponse,
  IncidentState,
} from "@/lib/api/contracts";

import {
  incidentHref,
  useIncident,
  useIncidentTimeline,
} from "./incident-queries";
import { Avatar } from "./incident-people";
import { ResponseAccessMark } from "./response-access";
import { incidentKey, SeverityMark, StatusMark } from "./severity";

/** Past this long without an update, an active incident's last one is stale. */
export const STALE_UPDATE_MS = 2 * 60 * 60_000;

/**
 * Where the response stands, in the words a list is scanned by: no one yet
 * (amber, while it waits on someone), ready to resolve (teal), or how many
 * are investigating and how many are done.
 */
function ResponseCell({
  incident,
  showWait = false,
}: {
  incident: IncidentListItemResponse;
  /** Say how long it has waited, beneath "No one yet". */
  showWait?: boolean;
}) {
  const { investigating, completed } = incident.response;
  const resolved = incident.status === "RESOLVED";

  if (investigating + completed === 0) {
    return resolved ? (
      <span className="text-fg-subtle">No one responded</span>
    ) : (
      <span className="flex flex-col">
        <span className="inline-flex items-center gap-1.5 text-warning-text">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-warning-text" />
          No one yet
        </span>
        {showWait && (
          <span className="data text-xs text-fg-subtle">
            waiting <Duration from={incident.createdAt} />
          </span>
        )}
      </span>
    );
  }

  if (resolved) {
    return (
      <span className="text-fg-muted">
        {completed + investigating} responded
      </span>
    );
  }

  if (investigating === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-status-resolved-text">
        <CircleCheck aria-hidden="true" strokeWidth={2} className="size-3.5" />
        Ready to resolve
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-status-investigating-text">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-status-investigating-text"
      />
      {/* One run of words, so it wraps as words rather than as flex items. */}
      <span>
        {investigating} investigating
        {completed > 0 && (
          <span className="text-fg-subtle"> · {completed} done</span>
        )}
      </span>
    </span>
  );
}

/** How long since the last update: amber once an active one goes quiet. */
function LastUpdateCell({ incident }: { incident: IncidentListItemResponse }) {
  const now = useMinuteClock();

  if (!incident.lastUpdateAt) {
    return <span className="text-fg-subtle">None yet</span>;
  }

  const age = now.getTime() - Date.parse(incident.lastUpdateAt);
  const stale = incident.status !== "RESOLVED" && age > STALE_UPDATE_MS;

  return (
    <time
      dateTime={incident.lastUpdateAt}
      className={cx("data", stale ? "text-warning-text" : "text-fg-muted")}
      title={stale ? "No update for a while" : undefined}
    >
      {formatDuration(age)} ago
    </time>
  );
}

/** The latest update, in full: who posted it, when, and what it said. */
function LatestUpdate({ incident }: { incident: IncidentListItemResponse }) {
  const organization = useOrganization();
  const now = useMinuteClock();
  // Asked only once the row is opened.
  const timeline = useIncidentTimeline(organization.id, incident.number);
  const latest = timeline.data?.findLast(({ type }) => type === "UPDATE");

  return (
    <PeekColumn
      title="Latest update"
      label={`Latest update on ${incidentKey(incident.number)}`}
    >
      {timeline.isError ? (
        <div className="p-3">
          <ErrorAlert error={timeline.error} />
        </div>
      ) : !timeline.data ? (
        <Spinner label="Loading the latest update…" />
      ) : !latest ? (
        <PeekEmpty>No updates posted yet.</PeekEmpty>
      ) : (
        <div className="flex flex-col gap-1.5 px-3.5 py-3">
          <p className="text-xs text-fg-muted">
            <span className="font-semibold text-fg">{latest.actor.name}</span>{" "}
            · {formatDuration(now.getTime() - Date.parse(latest.createdAt))} ago
          </p>
          <p className="text-sm leading-6 whitespace-pre-line text-fg">
            {latest.message}
          </p>
        </div>
      )}
    </PeekColumn>
  );
}

/**
 * Everyone who can respond and where each stands: those investigating, those
 * done, then the rest of the responsible team. Only the responders when the
 * caller cannot see the team's members; only them, too, once resolved.
 */
function CanRespond({ incident }: { incident: IncidentListItemResponse }) {
  const organization = useOrganization();
  const detail = useIncident(organization.id, incident.number);
  const members = useTeamMembers(organization.id, incident.team.id);
  const resolved = incident.status === "RESOLVED";

  const responders = detail.data?.responders ?? [];
  const responding = new Set(responders.map(({ membershipId }) => membershipId));
  const notJoined = resolved
    ? []
    : (members.data ?? []).filter(({ membershipId }) => !responding.has(membershipId));
  const people = [
    ...responders.map((responder) => ({
      id: responder.membershipId,
      name: responder.name,
      state: responder.status === "INVESTIGATING" ? ("investigating" as const) : ("complete" as const),
    })),
    ...notJoined.map(({ membershipId, user }) => ({
      id: membershipId,
      name: user.name,
      state: "quiet" as const,
    })),
  ];

  return (
    <PeekColumn
      title={resolved ? "Who responded" : "Who can respond"}
      count={detail.data ? people.length : undefined}
      label={`Who can respond to ${incidentKey(incident.number)}`}
    >
      {detail.isError ? (
        <div className="p-3">
          <ErrorAlert error={detail.error} />
        </div>
      ) : !detail.data ? (
        <Spinner label="Loading responders…" />
      ) : people.length === 0 ? (
        <PeekEmpty>
          {resolved ? "No one responded." : `No one on ${incident.team.name} yet.`}
        </PeekEmpty>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-2.5 px-3.5 py-2">
              <Avatar name={person.name} tone={person.state} size="sm" />
              <span
                className={cx(
                  "min-w-0 flex-1 truncate text-sm",
                  person.state === "quiet" ? "text-fg-muted" : "text-fg",
                )}
              >
                {person.name}
              </span>
              <span
                className={cx(
                  "text-xs",
                  person.state === "investigating" && "text-status-investigating-text",
                  person.state === "complete" && "text-status-resolved-text",
                  person.state === "quiet" && "text-fg-subtle",
                )}
              >
                {person.state === "investigating"
                  ? "investigating"
                  : person.state === "complete"
                    ? "done"
                    : "not joined"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PeekColumn>
  );
}

/**
 * Whether an incident waits on the caller: theirs to start — open to their
 * team, or assigned to them — active, not started by them, and still
 * wanting someone — nobody on it yet, or someone still investigating. The
 * API's `needs-you`, judged from one row.
 */
export const needsYou = (
  incident: IncidentListItemResponse,
  yourTeamIds: ReadonlySet<string>,
  membershipId: string,
) =>
  incident.status !== "RESOLVED" &&
  !incident.yourResponse &&
  (incident.responseAccess === "OPEN"
    ? yourTeamIds.has(incident.team.id)
    : incident.responseAccess === "ASSIGNED" &&
      incident.assignees.some((a) => a.membershipId === membershipId)) &&
  (incident.status === "DECLARED" || incident.response.investigating > 0);

/**
 * A member's own part in a row, beside the service and team: how long they
 * have been investigating, or when they completed.
 */
function YourPart({ incident }: { incident: IncidentListItemResponse }) {
  const now = useMinuteClock();
  const yours = incident.yourResponse;

  if (!yours) return null;

  return yours.status === "INVESTIGATING" ? (
    <span className="text-status-investigating-text">
      {" "}
      · you&apos;re investigating, <Duration from={yours.startedAt} />
    </span>
  ) : (
    <span className="text-status-resolved-text">
      {" "}
      · you completed
      {yours.completedAt &&
        ` ${formatDuration(now.getTime() - Date.parse(yours.completedAt))} ago`}
    </span>
  );
}

/** What a member's row offers: to respond, to post, or to look. */
const memberAction = (
  incident: IncidentListItemResponse,
  yourTeamIds: ReadonlySet<string>,
  membershipId: string,
) =>
  needsYou(incident, yourTeamIds, membershipId)
    ? { label: "Respond", tone: "primary" as const }
    : incident.status !== "RESOLVED" &&
        incident.yourResponse?.status === "INVESTIGATING"
      ? { label: "Post update", tone: "accent" as const }
      : { label: "View", tone: "accent" as const };

/**
 * A member's list on a phone: each incident a card, whole and tappable —
 * its severity, key, and how long it has been open; its title in full; its
 * service and team, with their own part; where the team's response stands;
 * and what the card offers them, as the table's action does. No table to
 * squeeze, and nothing to scroll sideways.
 */
export function IncidentCards({
  incidents,
  label,
  perspective = "member",
  yourTeamIds = new Set(),
}: {
  incidents: readonly IncidentListItemResponse[];
  label: string;
  /** Oversight's cards say no part of the reader's, and each offers View. */
  perspective?: "oversight" | "member";
  yourTeamIds?: ReadonlySet<string>;
}) {
  const organization = useOrganization();
  const member = perspective === "member";

  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-line-subtle overflow-hidden rounded-xl border border-line bg-surface"
    >
      {incidents.map((incident) => {
        const key = incidentKey(incident.number);
        const action = member
          ? memberAction(incident, yourTeamIds, organization.membership.id)
          : { label: "View", tone: "accent" as const };
        const active = incident.status !== "RESOLVED";
        const unstarted =
          incident.status !== "RESOLVED" &&
          incident.response.investigating + incident.response.completed === 0;

        return (
          <li key={incident.id} className="relative">
            {unstarted && (
              <span
                aria-hidden="true"
                className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-warning-text"
              />
            )}
            <Link
              href={incidentHref(organization.slug, incident.number)}
              aria-label={`${action.label} ${key}, ${incident.title}`}
              className="flex flex-col gap-1.5 px-4 py-3.5 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
            >
              <span className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2">
                  <SeverityMark severity={incident.severity} emphasis />
                  <span className="data text-fg-subtle">{key}</span>
                </span>
                <span className="data text-fg-muted">
                  <Duration from={incident.createdAt} to={incident.resolvedAt} />
                </span>
              </span>
              <span className="text-[0.9375rem] leading-snug font-semibold text-fg">
                {incident.title}
              </span>
              <span className="text-xs text-fg-muted">
                {incident.service.name} · {incident.team.name}
                {member && <YourPart incident={incident} />}
              </span>
              {active && (
                <ResponseAccessMark incident={incident} className="text-xs" />
              )}
              <span className="mt-1 flex items-center justify-between gap-3 text-sm">
                <ResponseCell incident={incident} />
                <span aria-hidden="true" className={rowActionClasses(action.tone)}>
                  {action.label}
                  <ChevronRight strokeWidth={2} className="size-3.5" />
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Incidents page's table: each incident with where its response stands
 * and how recently it was updated, a View action, and a row that opens in
 * place to show the latest update and who can respond — scanned, compared,
 * and only then opened. A team's or service's own page keeps the plainer
 * shared table.
 *
 * A member reads it as their work: no status column (the team's response
 * says it), their own part beside the service and team, an amber edge on
 * what nobody has started, and an action that follows their part — Respond,
 * Post update, or View. Each only opens the incident, where those actions
 * live.
 */
export function IncidentBoard({
  incidents,
  state,
  label,
  perspective = "oversight",
  yourTeamIds = new Set(),
}: {
  incidents: readonly IncidentListItemResponse[];
  state: IncidentState;
  label: string;
  /** Whose reading: the whole organization's, or one member's work. */
  perspective?: "oversight" | "member";
  /** The member's teams, for what waits on them. */
  yourTeamIds?: ReadonlySet<string>;
}) {
  const organization = useOrganization();
  const active = state === "active";
  const member = perspective === "member";
  // Any number open at once, so incidents can be compared side by side.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);

      if (!next.delete(id)) next.add(id);

      return next;
    });
  // A member's active list has no status column: the team's response says it.
  const showStatus = !(member && active);
  const columns = (showStatus ? 7 : 6) + (active ? 1 : 0);

  return (
    <Table label={label} variant="operational" stickyHeader fixed>
      <colgroup>
        <col className="w-27 sm:w-30" />
        <col />
        {showStatus && (
          <col className={cx("hidden w-34", active ? "sm:table-column" : "lg:table-column")} />
        )}
        <col className={cx("hidden md:table-column", member ? "w-44" : "w-40")} />
        {active && <col className="hidden w-44 xl:table-column" />}
        <col className="hidden w-28 lg:table-column" />
        <col className="w-19 sm:w-22" />
        <col className={member ? "w-30" : "w-22"} />
      </colgroup>
      <THead>
        <TR>
          <TH>Severity</TH>
          <TH>Incident</TH>
          {showStatus && (
            <TH className={cx("hidden", active ? "sm:table-cell" : "lg:table-cell")}>
              {active ? "Status" : "Resolved"}
            </TH>
          )}
          <TH className="hidden md:table-cell">
            {member ? "Team response" : "Responders"}
          </TH>
          {active && <TH className="hidden xl:table-cell">Who can respond</TH>}
          <TH className="hidden lg:table-cell">Last update</TH>
          <TH align="end">{active ? "Open for" : "Lasted"}</TH>
          <TH align="end">Action</TH>
        </TR>
      </THead>
      <TBody>
        {incidents.map((incident) => {
          const open = expanded.has(incident.id);
          const key = incidentKey(incident.number);
          const peekId = `incident-peek-${incident.id}`;
          const critical = incident.severity === "SEV1";
          // A member's eye goes first to what nobody has started.
          const unstarted =
            member &&
            incident.status !== "RESOLVED" &&
            incident.response.investigating + incident.response.completed === 0;
          const action = member
            ? memberAction(incident, yourTeamIds, organization.membership.id)
            : { label: "View", tone: "accent" as const };

          return (
            <Fragment key={incident.id}>
              <TR
                // A click anywhere on the row opens it, as the chevron does —
                // but not one meant for a link or an action.
                onClick={(event) => {
                  if ((event.target as Element).closest("a, button")) return;
                  toggle(incident.id);
                }}
                className="cursor-pointer"
              >
                <TD
                  className={cx(
                    "relative",
                    (critical || unstarted) &&
                      "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full",
                    unstarted
                      ? "before:bg-warning-text"
                      : critical && "before:bg-signal-critical",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={open ? peekId : undefined}
                      aria-label={`${open ? "Hide" : "Show"} the latest update and responders of ${key}`}
                      onClick={() => toggle(incident.id)}
                      className="grid size-6 shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        strokeWidth={2}
                        className={cx(
                          "size-4 transition-transform duration-(--duration-fast)",
                          open && "rotate-90",
                        )}
                      />
                    </button>
                    <SeverityMark severity={incident.severity} emphasis />
                  </div>
                </TD>
                <TD>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="data shrink-0 text-fg-subtle">{key}</span>
                    <span title={incident.title} className="truncate font-medium text-fg">
                      {incident.title}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    {incident.service.name} · {incident.team.name}
                    {member && <YourPart incident={incident} />}
                  </span>
                  {active && (
                    // Its own column once there is room for one.
                    <ResponseAccessMark incident={incident} className="text-xs xl:hidden" />
                  )}
                </TD>
                {showStatus && (
                  <TD className={cx("hidden", active ? "sm:table-cell" : "lg:table-cell")}>
                    {active ? (
                      <StatusMark status={incident.status} />
                    ) : (
                      <span className="data text-fg-muted">
                        {incident.resolvedAt && <IsoDate value={incident.resolvedAt} />}
                      </span>
                    )}
                  </TD>
                )}
                <TD className="hidden text-sm md:table-cell">
                  <ResponseCell incident={incident} showWait={member} />
                </TD>
                {active && (
                  <TD className="hidden text-sm xl:table-cell">
                    <ResponseAccessMark incident={incident} />
                  </TD>
                )}
                <TD className="hidden text-sm lg:table-cell">
                  <LastUpdateCell incident={incident} />
                </TD>
                <TD
                  align="end"
                  className={cx(
                    "data whitespace-nowrap",
                    critical && active ? "text-fg" : "text-fg-muted",
                  )}
                >
                  <Duration from={incident.createdAt} to={incident.resolvedAt} />
                </TD>
                <TD kind="actions">
                  <div className="flex justify-end">
                    <Link
                      href={incidentHref(organization.slug, incident.number)}
                      aria-label={`${action.label} ${key}`}
                      className={rowActionClasses(action.tone)}
                    >
                      {action.label}
                      <ChevronRight aria-hidden="true" strokeWidth={2} className="size-3.5" />
                    </Link>
                  </div>
                </TD>
              </TR>
              {open && (
                // A plain row, outside the table's hover: the row above, opened.
                <tr id={peekId}>
                  <td
                    colSpan={columns}
                    className="border-b border-line-subtle bg-sunken px-3 py-3 sm:px-4"
                  >
                    <div className="grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                      <LatestUpdate incident={incident} />
                      <CanRespond incident={incident} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </TBody>
    </Table>
  );
}
