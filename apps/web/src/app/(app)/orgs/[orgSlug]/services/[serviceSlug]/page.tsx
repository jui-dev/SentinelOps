import type { Metadata } from "next";

import { ServiceDetail } from "@/components/services/service-detail";

export const metadata: Metadata = { title: "Service" };

export default function ServicePage() {
  return <ServiceDetail />;
}
