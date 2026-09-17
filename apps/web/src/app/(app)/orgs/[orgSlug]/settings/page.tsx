import type { Metadata } from "next";

import { RenameOrganizationForm } from "@/components/organizations/rename-organization-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <RenameOrganizationForm />;
}
