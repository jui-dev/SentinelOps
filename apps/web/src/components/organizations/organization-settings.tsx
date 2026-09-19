"use client";

import { PageBody, PageHeader } from "@/components/ui/page";

import { RenameOrganizationForm } from "./rename-organization-form";

/** The Settings page: its header, then one row per setting. */
export function OrganizationSettings() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Organization-wide configuration. Changes apply to every member."
      />
      <PageBody width="form">
        <RenameOrganizationForm />
      </PageBody>
    </>
  );
}
