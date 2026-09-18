import type { Metadata } from "next";

import { InviteMemberForm } from "@/components/organizations/invite-member-form";
import { MembershipList } from "@/components/organizations/membership-list";
import { OpenInvitationList } from "@/components/organizations/open-invitation-list";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  // The invitation sections render only when the API reports the caller may
  // use them.
  return (
    <div className="flex flex-col gap-8">
      <MembershipList />
      <InviteMemberForm />
      <OpenInvitationList />
    </div>
  );
}
