"use client";

import {
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { useMemberships } from "@/components/organizations/membership-list";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Duration } from "@/components/ui/timestamp";
import type {
  IncidentDetailResponse,
  IncidentSeverity,
} from "@/lib/api/contracts";

import { AssignPeopleDialog } from "./assign-people-dialog";
import { Avatar, PeopleRow, usePeople } from "./incident-people";
import { useSetResponseAccess } from "./incident-queries";
import { AccessBadge, Band, Panel } from "./incident-response";
import { SeveritySelect } from "./incidents-view";

/** One of the two ways to answer "who should respond?". */
function Choice({
  badge,
  title,
  note,
  highlighted = false,
  action,
}: {
  badge: ReactNode;
  title: string;
  note: string;
  highlighted?: boolean;
  action: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-start gap-2.5 rounded-lg border p-4.5",
        highlighted
          ? "border-2 border-status-investigating-text bg-status-investigating-subtle"
          : "border-line bg-surface",
      )}
    >
      {badge}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      <p className="text-sm leading-6 text-fg-muted">{note}</p>
      <div className="mt-auto w-full pt-1 [&>button]:w-full">{action}</div>
    </div>
  );
}

/**
 * One person on an assigned incident: who they are, their team — the
 * responsible team called out — and where their part stands. Whoever has not
 * started can be taken off; whoever has begun cannot.
 */
function AssignedRow({
  incident,
  membershipId,
  name,
  teamNote,
  onResponsibleTeam,
  busy,
  onRemove,
}: {
  incident: IncidentDetailResponse;
  membershipId: string;
  name: string;
  teamNote: string | undefined;
  onResponsibleTeam: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const response = incident.responders.find((r) => r.membershipId === membershipId);

  return (
    <li
      className={cx(
        "flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-lg border px-4 py-3",
        onResponsibleTeam
          ? "border-status-investigating-line bg-status-investigating-subtle"
          : "border-line bg-surface",
      )}
    >
      <Avatar
        name={name}
        tone={
          response?.status === "INVESTIGATING"
            ? "investigating"
            : response
              ? "complete"
              : "quiet"
        }
      />
      <span className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-fg">{name}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          {onResponsibleTeam && (
            <span className="inline-flex h-5.5 items-center rounded-full bg-accent px-2 text-[0.6875rem] font-semibold text-on-accent">
              Responsible team
            </span>
          )}
          {teamNote}
        </span>
      </span>
      {response?.status === "INVESTIGATING" ? (
        <span className="text-sm text-status-investigating-text">
          Investigating{" "}
          <span className="data text-xs">
            · <Duration from={response.startedAt} />
          </span>
        </span>
      ) : response ? (
        <span className="text-sm text-status-resolved-text">Completed</span>
      ) : (
        <>
          <span className="text-sm text-warning-text">Assigned, not started</span>
          <button
            type="button"
            aria-label={`Remove ${name}`}
            disabled={busy}
            onClick={onRemove}
            className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus disabled:text-fg-disabled"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </>
      )}
    </li>
  );
}

/**
 * Who may respond to the incident, and the one place the Admin decides it.
 * Right after declaring it asks; once chosen it says what was chosen and who
 * is on it, and offers the other way.
 */
export function RespondersPanel({ incident }: { incident: IncidentDetailResponse }) {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  const people = usePeople(incident);
  const access = useSetResponseAccess(incident);
  const [assigning, setAssigning] = useState(false);
  // A suggested severity is settled with the decision: it starts from the
  // suggestion, and goes with whichever choice is made.
  const suggested = !incident.severityConfirmed;
  const [severity, setSeverity] = useState<IncidentSeverity>(incident.severity);
  const settling = suggested ? { severity } : {};
  const team = incident.team.name;
  const busy = access.isPending;
  const dialog = assigning && (
    <AssignPeopleDialog
      incident={incident}
      severity={suggested ? severity : undefined}
      onClose={() => setAssigning(false)}
    />
  );
  const failure = access.isError && (
    <div className="px-5 pb-4 sm:px-6">
      <ErrorAlert error={access.error} />
    </div>
  );
  const assign = (
    <Button icon={UserPlus} disabled={busy} onClick={() => setAssigning(true)}>
      Assign people
    </Button>
  );
  const open = (label: string, variant: "primary" | "secondary") => (
    <Button icon={Users}
      variant={variant}
      disabled={busy}
      onClick={() => access.mutate({ mode: "OPEN", ...settling })}
    >
      {busy ? "Saving…" : label}
    </Button>
  );

  if (incident.responseAccess === "PENDING") {
    return (
      <Panel
        id="responders"
        title="Next step · Responders"
        tone="amber"
        headline={
          <>
            Who should respond to this incident?
            <AccessBadge tone="amber">Needs your decision</AccessBadge>
          </>
        }
        aside={`${team} can see this incident, but nobody can start until you choose.`}
      >
        {failure}
        {suggested && (
          <div className="flex flex-col gap-1 border-t border-line-subtle px-5 py-4 sm:px-6">
            <div className="max-w-md">
              <SeveritySelect
                value={severity}
                onChange={setSeverity}
                label="Severity"
                note={`${incident.createdBy.name} suggested ${incident.severity}. Keep it or choose another: it's confirmed with your choice below.`}
              />
            </div>
          </div>
        )}
        <div className="grid gap-3.5 border-t border-line-subtle bg-canvas/30 px-5 py-4 sm:grid-cols-2 sm:px-6">
          <Choice
            highlighted
            badge={
              <span className="inline-flex h-5.5 items-center rounded-full bg-accent px-2.5 text-[0.6875rem] font-semibold text-on-accent">
                Responsible team
              </span>
            }
            title={`Open to ${team}`}
            note={`Everyone on ${team} can start responding on their own.`}
            action={open("Open to team", "primary")}
          />
          <Choice
            badge={
              <span className="inline-flex h-5.5 items-center rounded-full border border-line-strong px-2.5 text-[0.6875rem] font-semibold text-fg-muted">
                Specific people
              </span>
            }
            title="Assign people"
            note="Only the people you choose can respond. They can be from any team."
            action={assign}
          />
        </div>
        {dialog}
      </Panel>
    );
  }

  if (incident.responseAccess === "OPEN") {
    return (
      <Panel
        id="responders"
        title="Responders"
        tone="blue"
        headline={
          <>
            Open to {team}
            <AccessBadge tone="blue">Open to team</AccessBadge>
          </>
        }
        aside={`Everyone on ${team} can start responding on their own.`}
        action={assign}
      >
        {failure}
        {people.length > 0 && (
          <Band>
            <PeopleRow label={team} people={people} tone="blue" />
          </Band>
        )}
        {dialog}
      </Panel>
    );
  }

  const membersById = new Map((memberships.data ?? []).map((m) => [m.id, m]));
  const assignedIds = new Set(incident.assignees.map((a) => a.membershipId));
  // Everyone on it: those assigned, and anyone who responded before them.
  const rows = [
    ...incident.assignees,
    ...incident.responders.filter((r) => !assignedIds.has(r.membershipId)),
  ];
  const count = incident.assignees.length;

  return (
    <Panel
      id="responders"
      title="Responders"
      tone="blue"
      headline={
        <>
          Assigned to {count} {count === 1 ? "person" : "people"}
          <AccessBadge tone="blue">Assigned</AccessBadge>
        </>
      }
      aside="Only the people listed here can start a response."
      action={
        <div className="flex flex-wrap gap-2.5">
          {open("Open to team instead", "secondary")}
          {assign}
        </div>
      }
    >
      {failure}
      <Band className="block">
        <ul aria-label="People on this incident" className="flex w-full flex-col gap-2.5">
          {rows.map(({ membershipId, name }) => {
            const member = membersById.get(membershipId);
            const onResponsibleTeam =
              member?.teams.some(({ id }) => id === incident.team.id) ?? false;

            return (
              <AssignedRow
                key={membershipId}
                incident={incident}
                membershipId={membershipId}
                name={name}
                teamNote={
                  onResponsibleTeam
                    ? team
                    : member && (member.teams.map((t) => t.name).join(", ") || "No team")
                }
                onResponsibleTeam={onResponsibleTeam}
                busy={busy}
                onRemove={() =>
                  access.mutate({
                    mode: "ASSIGNED",
                    membershipIds: incident.assignees
                      .map((a) => a.membershipId)
                      .filter((id) => id !== membershipId),
                  })
                }
              />
            );
          })}
        </ul>
      </Band>
      {dialog}
    </Panel>
  );
}
