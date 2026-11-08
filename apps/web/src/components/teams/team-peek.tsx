"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { initialsOf } from "@/components/app/shell-utilities";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { CriticalityMark } from "@/components/services/criticality-mark";
import { serviceHref, useServices } from "@/components/services/service-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Permission } from "@/lib/api/contracts";
import type { TeamResponse } from "@/lib/api/contracts";

import { useTeamMembers } from "./team-scope";

/**
 * Past about five rows a column scrolls inside the expanded row, so every
 * one is here without the row growing past a glance.
 */
const SCROLL =
  "max-h-60 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

export function PeekColumn({
  title,
  count,
  label,
  children,
}: {
  title: string;
  count?: number;
  /** Names the scrolling list, for those who reach it by keyboard. */
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line-subtle bg-surface">
      <p className="flex items-baseline gap-1.5 border-b border-line-subtle bg-thead px-3.5 py-2 text-xs font-semibold tracking-[0.04em] text-fg-muted uppercase">
        {title}
        {count !== undefined && (
          <span className="numeric font-normal tracking-normal text-fg-subtle">
            {count}
          </span>
        )}
      </p>
      <div role="region" aria-label={label} tabIndex={0} className={SCROLL}>
        {children}
      </div>
    </div>
  );
}

export const PeekEmpty = ({ children }: { children: ReactNode }) => (
  <p className="px-3.5 py-3 text-sm text-fg-subtle">{children}</p>
);

function PeekMembers({ team }: { team: TeamResponse }) {
  const organization = useOrganization();
  // Asked only once the row is opened; kept after, as the team page's is.
  const members = useTeamMembers(organization.id, team.id);

  return (
    <PeekColumn
      title="Members"
      count={members.data?.length}
      label={`Members of ${team.name}`}
    >
      {members.isError ? (
        <div className="p-3">
          <ErrorAlert error={members.error} />
        </div>
      ) : !members.data ? (
        <Spinner label="Loading members…" />
      ) : members.data.length === 0 ? (
        <PeekEmpty>No one is on this team yet.</PeekEmpty>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {members.data.map((member) => (
            <li
              key={member.membershipId}
              className="flex items-center gap-2.5 px-3.5 py-2"
            >
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-full border border-accent-line bg-accent-subtle text-2xs font-semibold text-accent-text"
              >
                {initialsOf(member.user.name)}
              </span>
              <span className="min-w-0 truncate text-sm font-medium text-fg">
                {member.user.name}
              </span>
              <span className="min-w-0 truncate text-xs text-fg-subtle">
                {member.user.email}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PeekColumn>
  );
}

function PeekServices({ team }: { team: TeamResponse }) {
  const organization = useOrganization();
  // The organization's one service list: shared by every open row.
  const services = useServices(organization.id);
  const owned = services.data?.filter(
    (service) => service.ownerTeam.id === team.id,
  );

  return (
    <PeekColumn
      title="Services owned"
      count={owned?.length}
      label={`Services owned by ${team.name}`}
    >
      {services.isError ? (
        <div className="p-3">
          <ErrorAlert error={services.error} />
        </div>
      ) : !owned ? (
        <Spinner label="Loading services…" />
      ) : owned.length === 0 ? (
        <PeekEmpty>This team owns no services.</PeekEmpty>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {owned.map((service) => (
            <li key={service.id}>
              <Link
                href={serviceHref(organization.slug, service.slug)}
                className="flex items-center gap-3 px-3.5 py-2 text-sm transition-colors duration-(--duration-fast) hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-fg">
                  {service.name}
                  {service.archivedAt && (
                    <span className="font-normal text-fg-muted"> (archived)</span>
                  )}
                </span>
                <CriticalityMark criticality={service.criticality} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PeekColumn>
  );
}

/**
 * A team's row, opened: everyone on it and everything it owns, read only.
 * Each list scrolls in place past a handful, so all of it is here; the
 * team's page, one View away, is for the rest — its incidents.
 */
export function TeamPeek({ team }: { team: TeamResponse }) {
  const canReadServices = useCan(Permission.SERVICES_READ);

  return (
    <div className="grid grid-cols-1 gap-3 py-1 md:grid-cols-2">
      <PeekMembers team={team} />
      {canReadServices && <PeekServices team={team} />}
    </div>
  );
}
