"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { CriticalityMark } from "@/components/services/criticality-mark";
import { serviceHref } from "@/components/services/service-scope";
import { PeekColumn, PeekEmpty } from "@/components/teams/team-peek";
import { teamHref } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Permission } from "@/lib/api/contracts";
import type { OrganizationMembershipResponse } from "@/lib/api/contracts";
import { listServices } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

import { useCan, useOrganization } from "./organization-scope";

const ROW =
  "flex items-center gap-3 px-3.5 py-2 text-sm transition-colors duration-(--duration-fast) hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

/**
 * A member's row, opened: the teams they are on, and the services those
 * teams own — what they respond to. Both follow from their placements, so
 * this reads the list it already has and the organization's one service
 * list; it asks nothing about the person themselves.
 */
export function MemberPeek({ member }: { member: OrganizationMembershipResponse }) {
  const organization = useOrganization();
  const canReadServices = useCan(Permission.SERVICES_READ);
  // The Services pages' own query, by key: shared by every open row.
  const services = useQuery({
    queryKey: queryKeys.services(organization.id),
    queryFn: () => listServices(organization.id),
    enabled: canReadServices,
  });
  const first = member.user.name.split(/\s+/)[0];
  const teamIds = new Set(member.teams.map(({ id }) => id));
  const covered = services.data?.filter((service) =>
    teamIds.has(service.ownerTeam.id),
  );
  const ownedBy = (teamId: string) =>
    services.data
      ?.filter((service) => service.ownerTeam.id === teamId)
      .map(({ name }) => name);

  return (
    <div className="grid grid-cols-1 gap-3 py-1 md:grid-cols-2">
      <PeekColumn
        title="Teams"
        count={member.teams.length}
        label={`Teams of ${member.user.name}`}
      >
        {member.teams.length === 0 ? (
          <PeekEmpty>
            {member.role === "MEMBER"
              ? `${first} is on no team, so sees no incidents.`
              : `${first} is on no team.`}
          </PeekEmpty>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {member.teams.map((team) => {
              const owned = ownedBy(team.id);

              return (
                <li key={team.id}>
                  <Link
                    href={teamHref(organization.slug, team.slug)}
                    className={ROW}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-fg">
                      {team.name}
                    </span>
                    {owned && (
                      <span className="min-w-0 truncate text-xs text-fg-subtle">
                        {owned.length === 0
                          ? "Owns no services yet"
                          : `Owns ${owned.join(", ")}`}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PeekColumn>
      {canReadServices && (
        <PeekColumn
          title="Responds to"
          count={covered?.length}
          label={`Services ${member.user.name} responds to`}
        >
          {services.isError ? (
            <div className="p-3">
              <ErrorAlert error={services.error} />
            </div>
          ) : !covered ? (
            <Spinner label="Loading services…" />
          ) : covered.length === 0 ? (
            <PeekEmpty>
              {member.teams.length === 0
                ? "Nothing yet: people respond through their teams."
                : "Their teams own no services yet."}
            </PeekEmpty>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {covered.map((service) => (
                <li key={service.id}>
                  <Link
                    href={serviceHref(organization.slug, service.slug)}
                    className={ROW}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-fg">
                        {service.name}
                      </span>
                      <span className="truncate text-xs text-fg-subtle">
                        via {service.ownerTeam.name}
                      </span>
                    </span>
                    <CriticalityMark criticality={service.criticality} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PeekColumn>
      )}
    </div>
  );
}
