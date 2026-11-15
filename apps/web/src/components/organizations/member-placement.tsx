"use client";

import {
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { teamsHref, useTeams } from "@/components/teams/team-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { linkClasses } from "@/components/ui/link";
import { Spinner } from "@/components/ui/spinner";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type { OrganizationMembershipResponse } from "@/lib/api/contracts";
import {
  addTeamMember,
  listServices,
  removeTeamMember,
} from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { useCan, useOrganization } from "./organization-scope";

type Member = OrganizationMembershipResponse;

/**
 * After a placement changes, everything that shows it: this member's record,
 * the members list (its Teams column), and the teams — their member counts
 * and member lists, all beneath the `teams` prefix.
 */
export const useRefreshPlacements = (
  organizationId: string,
  membershipId: string,
) => {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.membership(organizationId, membershipId),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.memberships(organizationId),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.teams(organizationId),
    });
  };
};

/** A 404 or 409 means the page was out of date, not that something broke. */
const isStale = (error: unknown) =>
  isApiError(error, 404) || isApiError(error, 409);

const addErrorMessage = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.ALREADY_A_TEAM_MEMBER:
      return "They are already on that team. The list has been refreshed.";
    case ApiErrorCode.TEAM_NOT_FOUND:
      return "That team no longer exists. The list has been refreshed.";
    case ApiErrorCode.MEMBERSHIP_NOT_FOUND:
      return "This person is no longer a member of the organization.";
    case ApiErrorCode.PERMISSION_DENIED:
      return "You do not have permission to change teams.";
    default:
      return undefined;
  }
};

/**
 * The names of the services a team owns, for saying what a placement
 * means. Only with `services:read`, and only once the list is in; until
 * then, nothing — the dialog works without it.
 */
const useOwnedNames = () => {
  const organization = useOrganization();
  const canReadServices = useCan(Permission.SERVICES_READ);
  // The Services pages' own query, by key — asked only when it may be read.
  const services = useQuery({
    queryKey: queryKeys.services(organization.id),
    queryFn: () => listServices(organization.id),
    enabled: canReadServices,
  });

  return (teamId: string): string[] | undefined =>
    canReadServices
      ? services.data
          ?.filter((service) => service.ownerTeam.id === teamId)
          .map((service) => service.name)
      : undefined;
};

const ownsLine = (names: string[] | undefined) =>
  names === undefined
    ? undefined
    : names.length === 0
      ? "Owns no services yet"
      : `Owns ${names.join(", ")}`;

/** One choosable team: a radio and what choosing it means. */
function TeamChoice({
  name,
  value,
  detail,
  checked,
  onChange,
  tone,
}: {
  name: string;
  value: string;
  detail?: string;
  checked: boolean;
  onChange: () => void;
  tone: "accent" | "danger";
}) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors duration-(--duration-fast)",
        checked
          ? tone === "accent"
            ? "border-accent-line bg-accent-subtle"
            : "border-danger-line bg-danger-subtle"
          : "border-line hover:bg-hover",
      )}
    >
      <input
        type="radio"
        name="teamId"
        value={value}
        checked={checked}
        onChange={onChange}
        className={cx(
          "size-4 shrink-0",
          tone === "accent" ? "accent-accent-mark" : "accent-danger-solid",
        )}
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-fg">{name}</span>
        {detail && (
          <span className="truncate text-xs text-fg-subtle">{detail}</span>
        )}
      </span>
    </label>
  );
}

/** Places the member on one of the teams they are not on yet. */
export function AddToTeamDialog({
  member,
  onClose,
}: {
  member: Member;
  onClose: () => void;
}) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const ownedBy = useOwnedNames();
  const refresh = useRefreshPlacements(organization.id, member.id);
  const add = useMutation({
    mutationFn: (teamId: string) =>
      addTeamMember(organization.id, teamId, member.id),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (error) => {
      if (isStale(error)) refresh();
    },
  });
  const onTeam = new Set(member.teams.map(({ id }) => id));
  // Only teams they are not on: the same team cannot be offered twice.
  const available = teams.data?.filter(({ id }) => !onTeam.has(id));
  const [chosen, setChosen] = useState<string | null>(null);
  const selected =
    available?.find(({ id }) => id === chosen) ?? available?.[0];

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selected) add.mutate(selected.id);
  };

  let body;

  if (teams.isError) {
    body = <ErrorAlert error={teams.error} />;
  } else if (!available) {
    body = <Spinner label="Loading teams…" />;
  } else if (teams.data?.length === 0) {
    body = (
      <p className="text-sm text-fg-muted">
        There are no teams yet.{" "}
        <Link href={teamsHref(organization.slug)} className={linkClasses}>
          Create one
        </Link>{" "}
        to give people operational responsibility.
      </p>
    );
  } else if (available.length === 0) {
    body = (
      <p className="text-sm text-fg-muted">
        {member.user.name} is on every team.
      </p>
    );
  } else {
    body = (
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {add.isError && (
          <ErrorAlert error={add.error} message={addErrorMessage(add.error)} />
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-sm font-medium text-fg">Team</legend>
          {available.map((team) => (
            <TeamChoice
              key={team.id}
              name={team.name}
              value={team.id}
              detail={[
                ownsLine(ownedBy(team.id)),
                `${team.memberCount} ${team.memberCount === 1 ? "member" : "members"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              checked={team.id === selected?.id}
              onChange={() => setChosen(team.id)}
              tone="accent"
            />
          ))}
          {member.teams.length > 0 && (
            <p className="pt-1 text-xs text-fg-subtle">
              Already on {member.teams.map(({ name }) => name).join(", ")}, so
              not listed.
            </p>
          )}
        </fieldset>
        <DialogActions>
          <Button icon={X} variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={UserPlus} type="submit" disabled={add.isPending || !selected}>
            {add.isPending ? "Adding…" : `Add to ${selected?.name ?? "team"}`}
          </Button>
        </DialogActions>
      </form>
    );
  }

  return (
    <FormDialog
      title={`Add ${member.user.name} to a team`}
      description={`${member.user.name} will respond to incidents on the services that team owns.`}
      onClose={onClose}
    >
      {body}
    </FormDialog>
  );
}

/** Takes the member off one of their teams. */
export function RemoveFromTeamDialog({
  member,
  onClose,
}: {
  member: Member;
  onClose: () => void;
}) {
  const organization = useOrganization();
  const ownedBy = useOwnedNames();
  const refresh = useRefreshPlacements(organization.id, member.id);
  const remove = useMutation({
    mutationFn: (teamId: string) =>
      removeTeamMember(organization.id, teamId, member.id),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (error) => {
      if (isStale(error)) refresh();
    },
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const selected =
    member.teams.find(({ id }) => id === chosen) ?? member.teams[0];
  const others = member.teams.filter(({ id }) => id !== selected?.id);
  const owned = selected && ownedBy(selected.id);
  const first = member.user.name.split(/\s+/)[0];

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selected) remove.mutate(selected.id);
  };

  return (
    <FormDialog
      title={`Remove ${member.user.name} from a team`}
      description={`${first} stays in ${organization.name}, with every incident already worked.`}
      onClose={onClose}
    >
      {member.teams.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {member.user.name} is not on any team.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {remove.isError &&
            (isStale(remove.error) ? (
              <Alert tone="info">
                They were no longer on that team. The list has been refreshed.
              </Alert>
            ) : (
              <ErrorAlert error={remove.error} />
            ))}
          <fieldset className="flex flex-col gap-2">
            <legend className="pb-2 text-sm font-medium text-fg">
              {first}&rsquo;s teams
            </legend>
            {member.teams.map((team) => (
              <TeamChoice
                key={team.id}
                name={team.name}
                value={team.id}
                detail={ownsLine(ownedBy(team.id))}
                checked={team.id === selected?.id}
                onChange={() => setChosen(team.id)}
                tone="danger"
              />
            ))}
          </fieldset>
          {selected && (
            <Alert tone="warning">
              {owned && owned.length > 0
                ? `${first} will stop responding to ${owned.join(", ")} incidents.`
                : `${first} will stop responding to ${selected.name}'s incidents.`}{" "}
              {others.length > 0
                ? `Still on ${others.map(({ name }) => name).join(", ")}.`
                : `${first} will be on no team, and see no incidents.`}
            </Alert>
          )}
          <DialogActions>
            <Button icon={X} variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button icon={UserMinus}
              type="submit"
              variant="danger"
              disabled={remove.isPending || !selected}
            >
              {remove.isPending
                ? "Removing…"
                : `Remove from ${selected?.name ?? "team"}`}
            </Button>
          </DialogActions>
        </form>
      )}
    </FormDialog>
  );
}
