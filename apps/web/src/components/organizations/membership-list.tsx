"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { ErrorAlert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Status } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { IsoDate } from "@/components/ui/timestamp";
import type { OrganizationMembershipResponse } from "@/lib/api/contracts";
import { listMemberships } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { useCurrentUser } from "@/lib/auth/session-provider";

import { formatRole } from "./format";
import { memberHref } from "./member-paths";
import { useOrganization } from "./organization-scope";

export const useMemberships = (organizationId: string) =>
  useQuery({
    queryKey: queryKeys.memberships(organizationId),
    queryFn: () => listMemberships(organizationId),
  });

/** How many team names a row shows before summarising the rest. */
const SHOWN_TEAMS = 2;

/**
 * A member's teams in one short line: the first two by name, then "+N more".
 * The whole list is in the accessible name and the tooltip, so nothing is
 * hidden from anyone — the row just does not grow.
 */
export function TeamSummary({
  teams,
}: {
  teams: OrganizationMembershipResponse["teams"];
}) {
  if (teams.length === 0) {
    return <span className="text-fg-subtle">No team</span>;
  }

  const names = teams.map(({ name }) => name);
  const shown = names.slice(0, SHOWN_TEAMS).join(", ");
  const more = names.length - SHOWN_TEAMS;

  if (more <= 0) return <span>{shown}</span>;

  return (
    <span title={names.join(", ")}>
      <span aria-hidden="true">
        {shown} <span className="text-fg-subtle">+{more} more</span>
      </span>
      <span className="sr-only">{names.join(", ")}</span>
    </span>
  );
}

export function MembershipList() {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  const me = useCurrentUser();

  if (memberships.isError) return <ErrorAlert error={memberships.error} />;
  if (!memberships.data) return <Spinner label="Loading members…" />;

  return (
    <Table label="Members">
      <THead>
        <TR>
          <TH>Name</TH>
          <TH className="hidden sm:table-cell">Email</TH>
          <TH>Role</TH>
          <TH className="hidden md:table-cell">Teams</TH>
          <TH className="hidden lg:table-cell">Joined</TH>
        </TR>
      </THead>
      <TBody>
        {memberships.data.map((membership) => (
          <TR key={membership.id}>
            <TD>
              {/* The name opens the member's page: who they are, and their teams. */}
              <Link
                href={memberHref(organization.slug, membership.id)}
                className="rounded-sm font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {membership.user.name}
              </Link>
              {membership.user.id === me.data?.id && (
                <span className="ml-2 text-xs text-fg-subtle">You</span>
              )}
              {/* On narrow screens the email and teams fold under the name. */}
              <span className="block truncate text-xs text-fg-muted sm:hidden">
                {membership.user.email}
              </span>
              <span className="block truncate text-xs text-fg-muted md:hidden">
                <TeamSummary teams={membership.teams} />
              </span>
              {membership.user.passwordChangeRequired && (
                // Added with a one-time password they have not replaced yet.
                <span className="block">
                  <Status tone="warning" className="text-xs">
                    Awaiting first sign-in
                  </Status>
                </span>
              )}
            </TD>
            <TD kind="muted" className="hidden sm:table-cell">
              {membership.user.email}
            </TD>
            <TD kind="muted">{formatRole(membership.role)}</TD>
            <TD kind="muted" className="hidden max-w-56 truncate md:table-cell">
              <TeamSummary teams={membership.teams} />
            </TD>
            <TD kind="data" className="hidden lg:table-cell">
              <IsoDate value={membership.createdAt} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
