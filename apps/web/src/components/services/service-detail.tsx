"use client";

import Link from "next/link";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { useIncidentList } from "@/components/incidents/incident-queries";
import { RelatedIncidents } from "@/components/incidents/related-incidents";
import { SeverityMark } from "@/components/incidents/severity";
import { teamHref } from "@/components/teams/team-scope";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page";
import { RecordList, RecordRow } from "@/components/ui/record";
import { IsoDate } from "@/components/ui/timestamp";
import { quietLinkClasses } from "@/components/ui/link";
import { Permission } from "@/lib/api/contracts";

import { criticalityOf } from "./criticality";
import { CriticalityMark } from "./criticality-mark";
import { serviceHref, useService } from "./service-scope";

/**
 * Where the service stands now, from its active incidents: the most severe
 * of them and how many, or none. Derived, never stored — this is not a
 * health check, only what has been declared against it. Reads the same
 * list the Incidents section below does, so it is one request.
 */
function ActiveIncidents({ serviceId }: { serviceId: string }) {
  const organization = useOrganization();
  const list = useIncidentList(organization.id, "active", undefined, {
    serviceId,
  });

  if (list.isError) {
    return <span className="text-fg-muted">Could not be loaded</span>;
  }
  if (!list.data) return <span className="text-fg-muted">Loading…</span>;

  const first = list.data.pages[0]?.items ?? [];
  // Most severe first: the list's own order.
  const worst = first[0];

  if (!worst) {
    return (
      <span className="inline-flex items-center gap-2">
        <svg
          aria-hidden="true"
          viewBox="0 0 10 10"
          className="size-2.5 text-signal-nominal"
        >
          <circle cx="5" cy="5" r="3.75" fill="currentColor" />
        </svg>
        None
      </span>
    );
  }

  const count = list.hasNextPage ? `More than ${first.length}` : first.length;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <SeverityMark severity={worst.severity} label emphasis />
      <span className="numeric text-fg-muted">
        {count} active {first.length === 1 && !list.hasNextPage ? "incident" : "incidents"}
      </span>
    </span>
  );
}

/**
 * A service: what it is, which team owns it, how much the organization
 * depends on it, whether it is archived, and its incidents — active now and
 * recently resolved. No health or metrics: an incident is what says
 * something is wrong with it.
 */
export function ServiceDetail() {
  const organization = useOrganization();
  const service = useService();
  const canManage = useCan(Permission.SERVICES_MANAGE);
  const canReadIncidents = useCan(Permission.INCIDENTS_READ);
  const criticality = criticalityOf(service.criticality);

  return (
    <>
      <PageHeader
        width="list"
        title={service.name}
        description={service.description ?? undefined}
        actions={
          canManage && (
            <Link
              href={`${serviceHref(organization.slug, service.slug)}/settings`}
              className={buttonClasses({ variant: "secondary" })}
            >
              Settings
            </Link>
          )
        }
      />
      <PageBody width="list">
        {service.archivedAt && (
          <Alert tone="info" title="Archived">
            <p>
              Retired on <IsoDate value={service.archivedAt} />. It is kept for
              its incidents, and no new incident can be declared against it.
            </p>
          </Alert>
        )}
        <div className="flex max-w-3xl flex-col gap-8">
          <RecordList>
            <RecordRow label="Owner team">
              <Link
                href={teamHref(organization.slug, service.ownerTeam.slug)}
                className={`font-medium text-fg ${quietLinkClasses}`}
              >
                {service.ownerTeam.name}
              </Link>
            </RecordRow>
            {canReadIncidents && (
              <RecordRow label="Active incidents">
                <ActiveIncidents serviceId={service.id} />
              </RecordRow>
            )}
            <RecordRow label="Criticality">
              <CriticalityMark
                criticality={service.criticality}
                className="font-medium"
              />
              {criticality.definition && (
                <span className="mt-0.5 block text-sm text-fg-muted">
                  {criticality.definition}
                </span>
              )}
            </RecordRow>
          </RecordList>
          <RecordList tone="secondary">
            <RecordRow label="Created">
              <IsoDate value={service.createdAt} />
            </RecordRow>
            <RecordRow label="Updated">
              <IsoDate value={service.updatedAt} />
            </RecordRow>
          </RecordList>
        </div>
        {canReadIncidents && (
          <RelatedIncidents
            scope={{ serviceId: service.id, param: { service: service.slug } }}
            description={`Declared against ${service.name}.`}
          />
        )}
      </PageBody>
    </>
  );
}
