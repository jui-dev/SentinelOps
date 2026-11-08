import { redirect } from "next/navigation";

import { servicesHref } from "@/components/services/service-scope";

/**
 * Where a service's settings used to be. A service is edited from the
 * Services list now, so an old link or bookmark lands there.
 */
export default async function ServiceSettingsPage({
  params,
}: PageProps<"/orgs/[orgSlug]/services/[serviceSlug]/settings">) {
  const { orgSlug } = await params;

  redirect(servicesHref(orgSlug));
}
