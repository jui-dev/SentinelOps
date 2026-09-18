"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { organizationPath } from "@/components/app/navigation";
import { useOrganizationId } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody } from "@/components/ui/page";
import { PageSpinner } from "@/components/ui/spinner";
import { linkClasses } from "@/components/ui/link";
import type { TeamResponse } from "@/lib/api/contracts";
import { listTeams } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

export const teamsHref = (orgSlug: string) =>
  `${organizationPath(orgSlug)}/teams`;

export const teamHref = (orgSlug: string, teamSlug: string) =>
  `${teamsHref(orgSlug)}/${encodeURIComponent(teamSlug)}`;

/** The organization's teams. Team pages read their team from this too. */
export const useTeams = (organizationId: string) =>
  useQuery({
    queryKey: queryKeys.teams(organizationId),
    queryFn: () => listTeams(organizationId),
  });

/**
 * The team a page under `/teams/[teamSlug]` works on.
 *
 * URLs carry the slug; the API is addressed by id. The slug is resolved
 * against the organization's team list — the same way `OrganizationScope`
 * resolves an organization slug — which is stable because a team's slug never
 * changes.
 */
const TeamContext = createContext<TeamResponse | null>(null);

/** The current team. Only valid inside `TeamScope`. */
export const useTeam = (): TeamResponse => {
  const team = useContext(TeamContext);

  if (!team) {
    throw new Error("useTeam must be used within TeamScope");
  }

  return team;
};

export function TeamNotFound({ orgSlug }: { orgSlug: string }) {
  return (
    <PageBody width="form">
      <EmptyState
        className="mt-6"
        headingLevel={1}
        title="Team not found"
        action={
          <Link
            href={teamsHref(orgSlug)}
            className={`text-sm ${linkClasses}`}
          >
            All teams
          </Link>
        }
      >
        <p>It does not exist in this organization, or it was deleted.</p>
      </EmptyState>
    </PageBody>
  );
}

export function TeamScope({ children }: { children: ReactNode }) {
  const { orgSlug, teamSlug } = useParams<{
    orgSlug: string;
    teamSlug: string;
  }>();
  const teams = useTeams(useOrganizationId());

  if (teams.isError) {
    return (
      <PageBody width="form">
        <ErrorAlert error={teams.error} />
      </PageBody>
    );
  }

  if (!teams.data) return <PageSpinner />;

  const team = teams.data.find(({ slug }) => slug === teamSlug);

  if (!team) return <TeamNotFound orgSlug={orgSlug} />;

  return <TeamContext.Provider value={team}>{children}</TeamContext.Provider>;
}
