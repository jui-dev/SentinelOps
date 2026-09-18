import { ServiceScope } from "@/components/services/service-scope";

export default function ServiceLayout({
  children,
}: LayoutProps<"/orgs/[orgSlug]/services/[serviceSlug]">) {
  return <ServiceScope>{children}</ServiceScope>;
}
