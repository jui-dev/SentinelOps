import type { Metadata } from "next";

import { IncidentHistory } from "@/components/history/incident-history";

export const metadata: Metadata = { title: "Incident history" };

/**
 * Part of the Incidents domain, and a static segment, so it is matched
 * before the sibling `[incidentNumber]` — which only ever holds digits.
 */
export default function IncidentHistoryPage() {
  return <IncidentHistory />;
}
