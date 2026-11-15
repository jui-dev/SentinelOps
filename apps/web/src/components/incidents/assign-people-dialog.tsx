"use client";

import {
  ListChecks,
  ListX,
  UserPlus,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { useMemberships } from "@/components/organizations/membership-list";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { SubmitHint } from "@/components/ui/required";
import { Spinner } from "@/components/ui/spinner";
import type {
  IncidentSeverity,
  IncidentDetailResponse,
  OrganizationMembershipResponse,
} from "@/lib/api/contracts";

import { Avatar } from "./incident-people";
import { useSetResponseAccess } from "./incident-queries";
import { incidentKey } from "./severity";

/** Why a person cannot be unticked: they have already begun. */
const lockedReason = (
  incident: IncidentDetailResponse,
  membershipId: string,
): string | undefined => {
  const response = incident.responders.find(
    (responder) => responder.membershipId === membershipId,
  );

  if (response?.status === "INVESTIGATING") return "Already investigating";

  return response && incident.assignees.some((a) => a.membershipId === membershipId)
    ? "Completed"
    : undefined;
};

function PersonRow({
  incident,
  member,
  selected,
  onToggle,
  note,
}: {
  incident: IncidentDetailResponse;
  member: OrganizationMembershipResponse;
  selected: boolean;
  onToggle: () => void;
  note?: ReactNode;
}) {
  const locked = lockedReason(incident, member.id);

  return (
    <li>
      <label
        className={cx(
          "grid min-h-13 grid-cols-[1.125rem_auto_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-1.5",
          locked ? "cursor-default" : "cursor-pointer hover:bg-hover",
          selected && "bg-status-investigating-subtle",
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={locked !== undefined}
          onChange={onToggle}
          className="size-4.5 accent-(--color-accent)"
        />
        <Avatar name={member.user.name} tone="quiet" />
        <span className="truncate text-sm font-medium text-fg">{member.user.name}</span>
        <span className="text-xs text-fg-muted">{locked ?? note}</span>
      </label>
    </li>
  );
}

/**
 * Choosing who may respond, from anyone in the organization. The responsible
 * team comes first and stands apart, since it is who the incident belongs to
 * and usually who it goes to; everyone else follows, named by their teams.
 * Whoever has already begun stays ticked and cannot be unticked. Admins are
 * not offered: they oversee a response, they do not take part in one.
 */
export function AssignPeopleDialog({
  incident,
  severity,
  onClose,
}: {
  incident: IncidentDetailResponse;
  /** A suggested severity, confirmed with this choice. */
  severity?: IncidentSeverity;
  onClose: () => void;
}) {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  const assign = useSetResponseAccess(incident);
  const hintId = useId();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () =>
      new Set([
        ...incident.assignees.map(({ membershipId }) => membershipId),
        ...incident.responders
          .filter(({ status }) => status === "INVESTIGATING")
          .map(({ membershipId }) => membershipId),
      ]),
  );

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);

      if (!next.delete(id)) next.add(id);

      return next;
    });

  const people = (memberships.data ?? []).filter(
    ({ role }) => role === "RESPONDER",
  );
  const onTeam = (member: OrganizationMembershipResponse) =>
    member.teams.some(({ id }) => id === incident.team.id);
  const teamsOf = (member: OrganizationMembershipResponse) =>
    member.teams.map(({ name }) => name).join(", ") || "No team";
  const search = query.trim().toLowerCase();
  const matches = (member: OrganizationMembershipResponse) =>
    `${member.user.name} ${teamsOf(member)}`.toLowerCase().includes(search);
  const team = people.filter(onTeam);
  const shownTeam = team.filter(matches);
  const others = people.filter((member) => !onTeam(member)).filter(matches);
  const free = team.filter(({ id }) => !lockedReason(incident, id));
  const allOfTeam = free.length > 0 && free.every(({ id }) => chosen.has(id));
  const outside = people.filter((member) => chosen.has(member.id) && !onTeam(member));
  const count = chosen.size;
  const person = count === 1 ? "person" : "people";

  const toggleTeam = () =>
    setChosen((current) => {
      const next = new Set(current);

      for (const { id } of free) {
        if (allOfTeam) next.delete(id);
        else next.add(id);
      }

      return next;
    });

  return (
    <FormDialog
      title={`Assign people to ${incidentKey(incident.number)}`}
      description="Only the people you choose can start a response. Anyone already responding keeps going."
      onClose={onClose}
    >
      {memberships.isError ? (
        <ErrorAlert error={memberships.error} />
      ) : !memberships.data ? (
        <Spinner label="Loading people…" />
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (count > 0) {
              assign.mutate(
                {
                  mode: "ASSIGNED",
                  membershipIds: [...chosen],
                  ...(severity && { severity }),
                },
                { onSuccess: onClose },
              );
            }
          }}
        >
          {assign.isError && <ErrorAlert error={assign.error} />}
          <Field
            label="Find a person"
            name="person"
            autoComplete="off"
            placeholder="Search by name or team"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {(shownTeam.length > 0 || search === "") && (
            <fieldset className="overflow-hidden rounded-lg border-2 border-status-investigating-text bg-surface">
              <legend className="sr-only">{incident.team.name}, the responsible team</legend>
              <div className="flex items-center justify-between gap-3 border-b border-status-investigating-line bg-linear-to-r from-status-investigating-subtle to-transparent px-3.5 py-3">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-fg">
                      {incident.team.name}
                    </span>
                    <span className="inline-flex h-5.5 items-center rounded-full bg-accent px-2.5 text-[0.6875rem] font-semibold text-on-accent">
                      Responsible team
                    </span>
                  </span>
                  <span className="text-xs text-fg-muted">
                    Owns {incident.service.name}, the affected service
                  </span>
                </span>
                {free.length > 0 && (
                  <Button icon={allOfTeam ? ListX : ListChecks} variant="quiet" size="sm" onClick={toggleTeam}>
                    {allOfTeam ? "Clear team" : "Select all"}
                  </Button>
                )}
              </div>
              {shownTeam.length > 0 ? (
                <ul className="divide-y divide-line-subtle">
                  {shownTeam.map((member) => (
                    <PersonRow
                      key={member.id}
                      incident={incident}
                      member={member}
                      selected={chosen.has(member.id)}
                      onToggle={() => toggle(member.id)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-3.5 py-3 text-sm text-fg-muted">
                  Nobody is on {incident.team.name} yet.
                </p>
              )}
            </fieldset>
          )}

          {others.length > 0 && (
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend className="label-caps pb-1.5 text-fg-muted">
                Everyone else in the organization
              </legend>
              <ul className="max-h-56 divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line bg-surface">
                {others.map((member) => (
                  <PersonRow
                    key={member.id}
                    incident={incident}
                    member={member}
                    selected={chosen.has(member.id)}
                    onToggle={() => toggle(member.id)}
                    note={teamsOf(member)}
                  />
                ))}
              </ul>
            </fieldset>
          )}

          {search !== "" && shownTeam.length === 0 && others.length === 0 && (
            <p className="text-sm text-fg-muted">Nobody matches &ldquo;{query.trim()}&rdquo;.</p>
          )}

          <p className="text-sm text-fg-muted" aria-live="polite">
            <span className="font-semibold text-fg">
              {count} selected
            </span>
            {outside.length > 0 &&
              ` · ${outside.map((member) => member.user.name).join(", ")} ${
                outside.length === 1 ? "is" : "are"
              } outside ${incident.team.name}`}
          </p>

          <DialogActions>
            <SubmitHint
              id={hintId}
              missing={count === 0 ? ["at least one person"] : []}
            />
            <Button icon={X} variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button icon={UserPlus}
              type="submit"
              disabled={assign.isPending || count === 0}
              aria-describedby={count === 0 ? hintId : undefined}
            >
              {assign.isPending
                ? "Assigning…"
                : count === 0
                  ? "Assign people"
                  : `Assign ${count} ${person}`}
            </Button>
          </DialogActions>
        </form>
      )}
    </FormDialog>
  );
}
