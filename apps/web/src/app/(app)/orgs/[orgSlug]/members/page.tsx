import type { Metadata } from "next";

import { MembershipList } from "@/components/organizations/membership-list";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  return <MembershipList />;
}
