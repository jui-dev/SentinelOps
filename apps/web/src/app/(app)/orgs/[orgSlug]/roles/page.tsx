import type { Metadata } from "next";

import { RolesView } from "@/components/roles/roles-view";

export const metadata: Metadata = { title: "Roles" };

export default function RolesViewRoute() {
  return <RolesView />;
}
