"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";

import { organizationPath } from "@/components/app/navigation";
import { useOrganizationId } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody } from "@/components/ui/page";
import { PageSpinner } from "@/components/ui/spinner";
import { linkClasses } from "@/components/ui/link";
import type { TeamResponse } from "@/lib/api/contracts";
import { listTeamMembers, listTeams } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

export const teamsHref = (orgSlug: string) =>
  `${organizationPath(orgSlug)}/teams`;

/**
 * A team's page, addressed by its slug — `/teams/payments` — as services are.
 *
 * The slug never changes, even when the team is renamed, so the address is
 * as stable as the id it replaces. A reference that carries only the team's
 * id may pass that instead: the team page redirects it to the slug address.
 */
export const teamHref = (orgSlug: string, teamSlugOrId: string) =>
  `${teamsHref(orgSlug)}/${encodeURIComponent(teamSlugOrId)}`;

/** The organization's teams. Team pages read their team from this too. */
export const useTeams = (organizationId: string) =>
  useQuery({
    queryKey: queryKeys.teams(organizationId),
    queryFn: () => listTeams(organizationId),
  });

/**
 * Who is on one team. The team page lists them; an incident shows its
 * responsible team's members as who may respond to it.
 */
export const useTeamMembers = (organizationId: string, teamId: string) =>
  useQuery({
    queryKey: queryKeys.teamMembers(organizationId, teamId),
    queryFn: () => listTeamMembers(organizationId, teamId),
  });

/**
 * The team a page under `/teams/[teamId]` works on.
 *
 * The segment holds the team's slug, which never changes once the team is
 * created, so an address never depends on the team's name. It is resolved
 * against the organization's team list, which the team pages share. An id
 * in its place — a notification's reference, or an address from before
 * teams were addressed by slug — is redirected to the slug address.
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
  const { orgSlug, teamId } = useParams<{
    orgSlug: string;
    teamId: string;
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

  // The segment is decoded already; it is a slug, or an id to redirect.
  const team = teams.data.find(({ slug }) => slug === teamId);

  if (!team) {
    const byId = teams.data.find(({ id }) => id === teamId);

    return byId ? (
      <RedirectToSlug team={byId} />
    ) : (
      <TeamNotFound orgSlug={orgSlug} />
    );
  }

  return <TeamContext.Provider value={team}>{children}</TeamContext.Provider>;
}

/**
 * Replaces an id address with the team's slug address, keeping whatever
 * follows the team — `/teams/<id>/settings` becomes `/teams/<slug>/settings`.
 * Replaced, not pushed, so Back does not return to the id address.
 */
function RedirectToSlug({ team }: { team: TeamResponse }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const segments = pathname.split("/");
    const index = segments.indexOf("teams") + 1;

    segments[index] = encodeURIComponent(team.slug);
    router.replace(segments.join("/"));
  }, [pathname, router, team.slug]);

  return <PageSpinner />;
}
