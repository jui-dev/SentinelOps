"use client";

import Link from "next/link";

import { useOrganization } from "@/components/organizations/organization-scope";
import { CriticalityMark } from "@/components/services/criticality-mark";
import { serviceHref, useServices } from "@/components/services/service-scope";
import { teamHref, useTeamMembers } from "@/components/teams/team-scope";
import { DetailCard } from "@/components/ui/detail-layout";
import { linkClasses } from "@/components/ui/link";
import { Spinner } from "@/components/ui/spinner";
import type { ServiceResponse, TeamResponse } from "@/lib/api/contracts";

/**
 * The teams a member is on, as a roster: who else is on each, and the
 * services each owns — the services whose incidents reach them. Who is
 * placed where is the Admin's to change, on the Members list; this only
 * says how it stands.
 *
 * No counts of incidents here: how each team is doing is the response
 * flow's to show, beside it.
 */
function TeamEntry({
  team,
  services,
}: {
  team: TeamResponse;
  /** Every service the caller may read, once known. */
  services: ServiceResponse[] | undefined;
}) {
  const organization = useOrganization();
  const members = useTeamMembers(organization.id, team.id);
  const owned = services?.filter(({ ownerTeam }) => ownerTeam.id === team.id);
  const me = organization.membership.id;
  // The caller first, as "you"; then everyone else by name.
  const others = members.data
    ?.filter(({ membershipId }) => membershipId !== me)
    .map(({ user }) => user.name)
    .sort((a, b) => a.localeCompare(b));

  return (
    <li className="flex flex-col gap-2 px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Link
          href={teamHref(organization.slug, team.slug)}
          className={`font-semibold ${linkClasses}`}
        >
          {team.name}
        </Link>
        <span className="text-xs text-fg-subtle">
          {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
        </span>
      </div>
      {owned === undefined ? null : owned.length === 0 ? (
        <p className="text-xs text-fg-subtle">Owns no services yet.</p>
      ) : (
        <ul aria-label={`Services ${team.name} owns`} className="flex flex-wrap gap-1.5">
          {owned.map((service) => (
            <li key={service.id}>
              <Link
                href={serviceHref(organization.slug, service.slug)}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2 py-0.5 text-xs text-fg-muted hover:border-line-strong hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <CriticalityMark criticality={service.criticality} />
                {service.name}
                {service.archivedAt && <span className="text-fg-subtle">(archived)</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {others && (
        <p className="text-xs text-fg-subtle">
          {others.length === 0 ? "Only you" : `You, ${others.join(", ")}`}
        </p>
      )}
    </li>
  );
}

export function YourTeams({ teams }: { teams: TeamResponse[] }) {
  const organization = useOrganization();
  const services = useServices(organization.id);

  return (
    <DetailCard
      id="your-teams"
      title="Your teams"
      meta={teams.length}
      aside="Who is on them, and the services they own"
      footer="Incidents on these services reach you. The Admin places people on teams."
    >
      {services.isPending && !services.data ? (
        <Spinner label="Loading your teams' services…" />
      ) : (
        <ul aria-label="Your teams and their services" className="divide-y divide-line-subtle">
          {teams.map((team) => (
            <TeamEntry key={team.id} team={team} services={services.data} />
          ))}
        </ul>
      )}
    </DetailCard>
  );
}
