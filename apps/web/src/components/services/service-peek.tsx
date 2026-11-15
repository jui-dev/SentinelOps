"use client";

import Link from "next/link";

import { initialsOf } from "@/components/app/shell-utilities";
import {
  incidentHref,
  useIncidentList,
} from "@/components/incidents/incident-queries";
import {
  incidentKey,
  SeverityMark,
  StatusMark,
} from "@/components/incidents/severity";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { PeekColumn, PeekEmpty } from "@/components/teams/team-peek";
import { teamHref, useTeamMembers } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { linkClasses } from "@/components/ui/link";
import { Spinner } from "@/components/ui/spinner";
import { Permission } from "@/lib/api/contracts";
import type { ServiceResponse } from "@/lib/api/contracts";
import { isApiError } from "@/lib/api/errors";

/**
 * The service's active incidents, from the list the row's status was read
 * from — one cache, nothing asked for this row alone.
 */
function PeekIncidents({ service }: { service: ServiceResponse }) {
  const organization = useOrganization();
  const active = useIncidentList(organization.id, "active");
  const items = active.data?.pages[0]?.items.filter(
    (incident) => incident.service.id === service.id,
  );

  return (
    <PeekColumn
      title="Active incidents"
      count={items?.length}
      label={`Active incidents of ${service.name}`}
    >
      {active.isError ? (
        <div className="p-3">
          <ErrorAlert error={active.error} />
        </div>
      ) : !items ? (
        <Spinner label="Loading incidents…" />
      ) : items.length === 0 ? (
        <PeekEmpty>
          {service.archivedAt
            ? "Archived: no incident can be declared against it."
            : "Nothing needs a response right now."}
        </PeekEmpty>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {items.map((incident) => (
            <li key={incident.id}>
              <Link
                href={incidentHref(organization.slug, incident.number)}
                className="flex items-center gap-3 px-3.5 py-2 text-sm transition-colors duration-(--duration-fast) hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
              >
                <SeverityMark severity={incident.severity} emphasis />
                <span className="data shrink-0 text-fg-subtle">
                  {incidentKey(incident.number)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-fg">
                  {incident.title}
                </span>
                <StatusMark status={incident.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PeekColumn>
  );
}

/**
 * Who responds to the service's incidents: the members of its owner team,
 * asked for only once the row is opened. A member may read only their own
 * teams; for another team's service the API hides its members, and this
 * names the team instead.
 */
function PeekResponders({ service }: { service: ServiceResponse }) {
  const organization = useOrganization();
  const members = useTeamMembers(organization.id, service.ownerTeam.id);
  const team = (
    <Link
      href={teamHref(organization.slug, service.ownerTeam.slug)}
      className={linkClasses}
    >
      {service.ownerTeam.name}
    </Link>
  );

  return (
    <PeekColumn
      title="Who responds"
      kind="people"
      count={members.data?.length}
      label={`Who responds to ${service.name}`}
    >
      {isApiError(members.error, 404) ? (
        <PeekEmpty>The members of {team}, which owns this service.</PeekEmpty>
      ) : members.isError ? (
        <div className="p-3">
          <ErrorAlert error={members.error} />
        </div>
      ) : !members.data ? (
        <Spinner label="Loading responders…" />
      ) : members.data.length === 0 ? (
        <PeekEmpty>
          No one is on {team} yet, so no one would respond.
        </PeekEmpty>
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

/**
 * A service's row, opened: what is wrong with it now, and who would
 * respond. Each list scrolls in place past a handful.
 */
export function ServicePeek({ service }: { service: ServiceResponse }) {
  const canReadIncidents = useCan(Permission.INCIDENTS_READ);
  const canReadTeams = useCan(Permission.TEAMS_READ);

  return (
    <div className="grid grid-cols-1 gap-3 py-1 md:grid-cols-2">
      {canReadIncidents && <PeekIncidents service={service} />}
      {canReadTeams && <PeekResponders service={service} />}
    </div>
  );
}
