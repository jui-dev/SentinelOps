import type { Metadata } from "next";

import { OrganizationOverview } from "@/components/organizations/organization-overview";

export const metadata: Metadata = { title: "Overview" };

export default function OrganizationOverviewPage() {
  return <OrganizationOverview />;
}
