"use client";

import Link from "next/link";

import { organizationPath } from "@/components/app/navigation";
import { buttonClasses } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Permission } from "@/lib/api/contracts";

import { MembershipList, useMemberships } from "./membership-list";
import { useCan, useOrganization } from "./organization-scope";

export const membersHref = (orgSlug: string) =>
  `${organizationPath(orgSlug)}/members`;

export const addMemberHref = (orgSlug: string) =>
  `${membersHref(orgSlug)}/new`;

/**
 * The organization's people, at a glance: who they are, their role, the
 * teams they are on, and who has yet to sign in for the first time. Adding
 * someone is its own page, reached from the header; invitations are not
 * offered while they are switched off.
 */
export function MembersView() {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  // Advice only, like every useCan: the API authorizes adding regardless.
  const canAddMembers = useCan(Permission.MEMBERS_MANAGE);

  return (
    <>
      <PageHeader
        width="list"
        title="Members"
        meta={memberships.data?.length}
        description="Everyone with access to this organization. The Admin sets it up — its members, teams, and services; Members do the operational work."
        actions={
          canAddMembers && (
            <Link
              href={addMemberHref(organization.slug)}
              className={buttonClasses()}
            >
              Add member
            </Link>
          )
        }
      />
      <PageBody width="list">
        <MembershipList />
      </PageBody>
    </>
  );
}
