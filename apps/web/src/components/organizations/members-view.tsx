"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Permission } from "@/lib/api/contracts";

import { AddMemberDialog } from "./add-member-form";
import { MembershipList, useMemberships } from "./membership-list";
import { useCan, useOrganization } from "./organization-scope";

/**
 * The organization's people, at a glance: who they are, their role, the
 * teams they are on, and who has yet to sign in for the first time. Adding
 * someone is a dialog opened from the header; invitations are not offered
 * while they are switched off.
 */
export function MembersView() {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  // Advice only, like every useCan: the API authorizes adding regardless.
  const canAddMembers = useCan(Permission.MEMBERS_MANAGE);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        width="full"
        title="Members"
        meta={memberships.data?.length}
        description="Everyone with access to this organization. Their teams decide which incidents they respond to."
        actions={
          canAddMembers && (
            <Button onClick={() => setAdding(true)}>Add member</Button>
          )
        }
      />
      <PageBody width="full">
        <MembershipList />
      </PageBody>
      {canAddMembers && adding && (
        <AddMemberDialog onClose={() => setAdding(false)} />
      )}
    </>
  );
}
