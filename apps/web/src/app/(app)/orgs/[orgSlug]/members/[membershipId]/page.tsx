import type { Metadata } from "next";

import { MemberDetail } from "@/components/organizations/member-detail";

export const metadata: Metadata = { title: "Member" };

export default function MemberPage() {
  return <MemberDetail />;
}
