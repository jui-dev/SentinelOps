import { OrganizationScope } from "@/components/organizations/organization-scope";

export default function OrganizationLayout({
  children,
}: LayoutProps<"/orgs/[orgSlug]">) {
  return <OrganizationScope>{children}</OrganizationScope>;
}
