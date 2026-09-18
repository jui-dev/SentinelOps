import type { Metadata } from "next";

import { ServiceSettings } from "@/components/services/service-settings";

export const metadata: Metadata = { title: "Service settings" };

export default function ServiceSettingsPage() {
  return <ServiceSettings />;
}
