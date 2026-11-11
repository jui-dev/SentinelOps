"use client";

import { CircleCheck } from "lucide-react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { useTeamMembers } from "@/components/teams/team-scope";
import { cx } from "@/components/ui/cx";
import { Duration } from "@/components/ui/timestamp";
import type { IncidentDetailResponse } from "@/lib/api/contracts";

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
 * blue while investigating, teal once complete — and teal for the caller
 * themselves, wherever they are — quiet when they have not joined.
 * Decoration: their name is written beside it.
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

export type PersonState = "investigating" | "complete" | "not-joined";

export interface Person {
  membershipId: string;
  name: string;
  state: PersonState;
  /** When their part started, and ended once complete. */
  startedAt?: string;
  completedAt?: string | null;
}

/**
 * Everyone who can respond and where each stands: whoever is investigating,
 * whoever is done, then those who have not joined — the people assigned,
 * when the incident is assigned, else its responsible team. Someone who started before a reassignment stays, though no longer
 * on the team. Once resolved, only those who responded; when the caller
 * cannot see the team's members, only the responders. The caller first,
 * when they are among them.
 */
export const usePeople = (incident: IncidentDetailResponse): Person[] => {
  const organization = useOrganization();
  const members = useTeamMembers(organization.id, incident.team.id);
  const resolved = incident.status === "RESOLVED";
  const responding = new Set(incident.responders.map(({ membershipId }) => membershipId));
  const me = organization.membership.id;

  const people: Person[] = [
    ...incident.responders
      .filter(({ status }) => status === "INVESTIGATING")
      .map((responder) => ({ ...responder, state: "investigating" as const })),
    ...incident.responders
      .filter(({ status }) => status === "COMPLETED")
      .map((responder) => ({ ...responder, state: "complete" as const })),
    ...(resolved
      ? []
      : (incident.responseAccess === "ASSIGNED"
          ? incident.assignees
          : (members.data ?? []).map(({ membershipId, user }) => ({
              membershipId,
              name: user.name,
            }))
        )
          .filter(({ membershipId }) => !responding.has(membershipId))
          .map((person) => ({ ...person, state: "not-joined" as const }))),
  ];

  return [
    ...people.filter(({ membershipId }) => membershipId === me),
    ...people.filter(({ membershipId }) => membershipId !== me),
  ];
};

/**
 * The people on an incident as one row of chips, each with where their part
 * stands: investigating and for how long, done, or not joined. "You" for
 * the caller. Its own list, named for what it holds.
 */
export function PeopleRow({
  label,
  people,
  tone = "teal",
}: {
  /** What the row is, as a short caption and the list's name. */
  label: string;
  people: readonly Person[];
  /** The panel it sits in: a member's teal, or oversight's blue. */
  tone?: "teal" | "blue";
}) {
  const organization = useOrganization();

  if (people.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs text-fg-muted">{label}</span>
      <ul aria-label={label} className="flex flex-wrap gap-2">
        {people.map((person) => {
          const you = person.membershipId === organization.membership.id;

          return (
            <li
              key={person.membershipId}
              className={cx(
                "inline-flex h-9 items-center gap-2 rounded-full border py-0.5 pr-3 pl-1 text-sm",
                person.state === "not-joined"
                  ? "border-dashed border-line-strong text-fg-muted"
                  : tone === "teal"
                    ? "border-status-resolved-line/60 bg-canvas/40 text-fg"
                    : "border-status-investigating-line/60 bg-canvas/40 text-fg",
              )}
            >
              <Avatar
                name={person.name}
                size="sm"
                tone={
                  you
                    ? "complete"
                    : person.state === "investigating"
                      ? "investigating"
                      : person.state === "complete"
                        ? "complete"
                        : "quiet"
                }
              />
              <span className="font-medium">{you ? "You" : person.name}</span>
              {person.state === "investigating" ? (
                <span className="data text-xs text-status-investigating-text">
                  investigating{" "}
                  {person.startedAt && <Duration from={person.startedAt} />}
                </span>
              ) : person.state === "complete" ? (
                <span className="inline-flex items-center gap-1 text-xs text-status-resolved-text">
                  <CircleCheck aria-hidden="true" strokeWidth={2} className="size-3" />
                  done
                </span>
              ) : (
                <span className="text-xs text-fg-subtle">not joined</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
