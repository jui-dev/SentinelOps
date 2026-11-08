import { redirect } from "next/navigation";

import { teamsHref } from "@/components/teams/team-scope";

/**
 * Where a team's settings used to be. A team is edited from the Teams list
 * now, so an old link or bookmark lands there.
 */
export default async function TeamSettingsPage({
  params,
}: PageProps<"/orgs/[orgSlug]/teams/[teamId]/settings">) {
  const { orgSlug } = await params;

  redirect(teamsHref(orgSlug));
}
