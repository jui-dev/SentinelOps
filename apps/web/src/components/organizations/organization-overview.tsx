"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { organizationPath } from "@/components/app/navigation";
import { PageBody, PageHeader, Section } from "@/components/ui/page";
import { RecordList, RecordRow } from "@/components/ui/record";
import { IsoDate } from "@/components/ui/timestamp";
import { quietLinkClasses } from "@/components/ui/link";
import { Permission } from "@/lib/api/contracts";
import { listMemberships } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

import { formatDate, formatRole } from "./format";
import { useCan, useOrganization, useOrganizationId } from "./organization-scope";

/** How many people belong, linking to them. Shares the Members page's query. */
function MemberCount({ slug }: { slug: string }) {
  const organizationId = useOrganizationId();
  const memberships = useQuery({
    queryKey: queryKeys.memberships(organizationId),
    queryFn: () => listMemberships(organizationId),
  });

  return (
    <Link
      href={`${organizationPath(slug)}/members`}
      className={`group inline-flex items-center gap-1.5 text-fg ${quietLinkClasses}`}
    >
      {memberships.data ? (
        <>
          <span className="data text-[0.875rem] text-inherit">
            {memberships.data.length}
          </span>{" "}
          {memberships.data.length === 1 ? "member" : "members"}
        </>
      ) : (
        "View members"
      )}
      <ArrowRight
        aria-hidden="true"
        className="size-3.5 text-fg-subtle group-hover:text-accent-text"
      />
    </Link>
  );
}

export function OrganizationOverview() {
  const organization = useOrganization();
  const canReadMembers = useCan(Permission.MEMBERSHIPS_READ);
  const { membership } = organization;

  return (
    <>
      <PageHeader eyebrow={organization.name} title="Overview" />
      {/*
        The record, and beside it (on wide screens) the technical metadata
        — secondary, so it is set smaller and quieter, not hidden.
      */}
      <PageBody>
        <div className="grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,48rem)_minmax(18rem,26rem)]">
          <Section title="Organization">
            <RecordList>
              <RecordRow label="Name">{organization.name}</RecordRow>
              <RecordRow label="URL name">
                <span className="data text-[0.875rem] text-fg">
                  {organization.slug}
                </span>
              </RecordRow>
              <RecordRow label="Your role">{formatRole(membership.role)}</RecordRow>
              {canReadMembers && (
                <RecordRow label="Members">
                  <MemberCount slug={organization.slug} />
                </RecordRow>
              )}
              <RecordRow label="Created">
                {formatDate(organization.createdAt)}
              </RecordRow>
            </RecordList>
          </Section>

          {/*
            Secondary, so grouped in a quiet panel rather than ruled off:
            present for whoever needs it, out of the way of everyone else.
          */}
          <Section
            title="Technical details"
            level={3}
            description="For support requests and API work. What you may do here is reported by the API, which checks every request itself."
            className="rounded-lg border border-line-subtle bg-surface p-5"
          >
            <RecordList tone="secondary" stacked>
              <RecordRow label="Organization ID">
                <code className="data break-all text-fg-muted select-all">
                  {organization.id}
                </code>
              </RecordRow>
              <RecordRow label="Created (UTC)">
                <span className="data">
                  <IsoDate value={organization.createdAt} />
                </span>
              </RecordRow>
              <RecordRow label="Your access">
                <ul className="flex flex-col gap-0.5">
                  {[...membership.permissions].sort().map((permission) => (
                    <li key={permission} className="data text-fg-muted">
                      {permission}
                    </li>
                  ))}
                </ul>
              </RecordRow>
            </RecordList>
          </Section>
        </div>
      </PageBody>
    </>
  );
}
