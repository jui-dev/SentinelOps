"use client";

import { OperationsOverview } from "@/components/overview/operations-overview";
import { EmptyNote } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Permission } from "@/lib/api/contracts";

import { useCan } from "./organization-scope";

/**
 * The organization's front page: its operations. Every role reads incidents
 * today; should one not, the page says why it is empty rather than being so.
 */
export function OrganizationOverview() {
  const canReadIncidents = useCan(Permission.INCIDENTS_READ);

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          canReadIncidents
            ? "Where incident response stands now: what needs you, and every incident still unresolved."
            : undefined
        }
      />
      <PageBody>
        {canReadIncidents ? (
          <OperationsOverview />
        ) : (
          <EmptyNote title="No operations to show">
            Your role does not include reading incidents.
          </EmptyNote>
        )}
      </PageBody>
    </>
  );
}
