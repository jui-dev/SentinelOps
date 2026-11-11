import type { Metadata } from "next";

import { RolePage } from "@/components/roles/role-page";

export const metadata: Metadata = { title: "Role" };

export default function RolePageRoute() {
  return <RolePage />;
}
