"use client";

import { incidentsHref } from "@/components/incidents/incident-queries";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { EmptyState } from "@/components/ui/empty-state";
import { OnwardLink } from "@/components/ui/onward-link";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Permission } from "@/lib/api/contracts";

/**
 * My Operations: where a member enters their organization.
 *
 * The Overview answers "how is the organization doing", which is oversight —
 * it counts every incident, including the ones a member may not open, so the
 * API answers it only to `incidents:read-all`. This page is the other
 * question, "what is mine", and it is what everyone else lands on.
 *
 * A foundation, deliberately: the heading, what will live here, and the one
 * place that already answers the question today. It reads nothing. Figures a
 * member has no scoped endpoint for yet would have to be borrowed from the
 * organization's, which is the exposure this page exists to end — so there
 * are none, rather than plausible ones.
 */
export function MyOperations() {
  const organization = useOrganization();
  const canReadIncidents = useCan(Permission.INCIDENTS_READ);

  return (
    <>
      <PageHeader
        title="My Operations"
        description="Your incidents, responsibilities, teams, and operational activity."
      />
      <PageBody>
        <EmptyState
          title="Your workspace is being built"
          action={
            canReadIncidents && (
              <OnwardLink href={incidentsHref(organization.slug)}>
                Go to Incidents
              </OnwardLink>
            )
          }
        >
          <p>
            What needs your attention, the incidents you are responsible for,
            and the teams you are on will be gathered here. Until they are,
            Incidents lists everything that is yours.
          </p>
        </EmptyState>
      </PageBody>
    </>
  );
}
