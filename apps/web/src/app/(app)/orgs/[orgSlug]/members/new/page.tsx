import type { Metadata } from "next";

import { AddMemberView } from "@/components/organizations/add-member-view";

export const metadata: Metadata = { title: "Add member" };

export default function AddMemberPage() {
  return <AddMemberView />;
}
