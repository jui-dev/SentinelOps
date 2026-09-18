import type { Metadata } from "next";

import { IncidentDetail } from "@/components/incidents/incident-detail";

export const metadata: Metadata = { title: "Incident" };

export default function IncidentPage() {
  return <IncidentDetail />;
}
