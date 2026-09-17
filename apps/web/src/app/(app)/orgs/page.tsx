import type { Metadata } from "next";

import { OrganizationPicker } from "@/components/organizations/organization-picker";

export const metadata: Metadata = { title: "Organizations" };

export default function OrganizationsPage() {
  return <OrganizationPicker />;
}
