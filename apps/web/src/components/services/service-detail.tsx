"use client";

import Link from "next/link";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
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
 * A service: what it is, which team owns it, how much the organization
 * depends on it, and whether it is archived. Only what the service record
 * holds — no health, metrics, or per-service incident history.
 */
export function ServiceDetail() {
  const organization = useOrganization();
  const service = useService();
  const canManage = useCan(Permission.SERVICES_MANAGE);
  const criticality = criticalityOf(service.criticality);

  return (
    <>
      <PageHeader
        eyebrow={organization.name}
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
      <PageBody width="form">
        {service.archivedAt && (
          <Alert tone="info" title="Archived">
            <p>
              Retired on <IsoDate value={service.archivedAt} />. It is kept for
              its incidents, and no new incident can be declared against it.
            </p>
          </Alert>
        )}
        <div className="flex flex-col gap-8">
          <RecordList>
            <RecordRow label="Owner team">
              <Link
                href={teamHref(organization.slug, service.ownerTeam.slug)}
                className={`font-medium text-fg ${quietLinkClasses}`}
              >
                {service.ownerTeam.name}
              </Link>
            </RecordRow>
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
      </PageBody>
    </>
  );
}
