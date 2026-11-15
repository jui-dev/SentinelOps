"use client";

import { DemoWorkspace } from "@/components/demo/demo-workspace";
import { PageBody, PageHeader } from "@/components/ui/page";

import { useOrganization } from "./organization-scope";

import { RenameOrganizationForm } from "./rename-organization-form";

/** The Settings page: its header, one row per setting, and a demo its upkeep. */
export function OrganizationSettings() {
  // The demo workspace needs the room its parts are listed in.
  const { demo } = useOrganization();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organization-wide configuration. Changes apply to every member."
      />
      <PageBody width={demo ? "list" : "form"}>
        <div className="flex flex-col gap-6">
          <RenameOrganizationForm />
          {/* A demo organization's own upkeep: development only. */}
          <DemoWorkspace />
        </div>
      </PageBody>
    </>
  );
}
