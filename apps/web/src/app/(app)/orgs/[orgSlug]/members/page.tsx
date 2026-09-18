import type { Metadata } from "next";

import { MembersView } from "@/components/organizations/members-view";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  return <MembersView />;
}
