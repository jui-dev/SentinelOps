import { TeamScope } from "@/components/teams/team-scope";

export default function TeamLayout({
  children,
}: LayoutProps<"/orgs/[orgSlug]/teams/[teamSlug]">) {
  return <TeamScope>{children}</TeamScope>;
}
