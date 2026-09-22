import type { Metadata } from "next";

import { IncidentAnalysisPage } from "@/components/incident-analyses/incident-analysis-page";

export const metadata: Metadata = { title: "Incident analysis" };

export default function AnalysisPage() {
  return <IncidentAnalysisPage />;
}
