"use client";

import { PageBody, PageHeader, Section } from "@/components/ui/page";
import { Permission } from "@/lib/api/contracts";

import { InviteMemberForm } from "./invite-member-form";
import { MembershipList, useMemberships } from "./membership-list";
import { OpenInvitationList } from "./open-invitation-list";
import { useCan, useOrganization } from "./organization-scope";

export function MembersView() {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  // The invitation parts render only when the API reports the caller may
  // use them — as advice; the API authorizes both regardless.
  const canInvite = useCan(Permission.INVITATIONS_MANAGE);
  const canSeeInvitations = useCan(Permission.INVITATIONS_READ);

  return (
    <>
      <PageHeader
        eyebrow={organization.name}
        title="Members"
        meta={memberships.data?.length}
        description="Everyone with access to this organization. A person's role decides what they can change."
      />
      <PageBody>
        <MembershipList />
        {(canInvite || canSeeInvitations) && (
          <Section
            id="invitations"
            title="Invitations"
            description="Each invitation link works once and expires 7 days after it is created."
            spacing="loose"
            className="border-t border-line pt-6"
          >
            <InviteMemberForm />
            <OpenInvitationList />
          </Section>
        )}
      </PageBody>
    </>
  );
}
