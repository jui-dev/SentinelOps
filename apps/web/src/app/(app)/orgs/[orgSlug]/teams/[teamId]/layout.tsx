import { TeamScope } from "@/components/teams/team-scope";

export default function TeamLayout({
  children,
}: LayoutProps<"/orgs/[orgSlug]/teams/[teamId]">) {
  return <TeamScope>{children}</TeamScope>;
}
