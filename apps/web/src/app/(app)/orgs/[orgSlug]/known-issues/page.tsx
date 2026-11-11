import type { Metadata } from "next";

import { KnownIssuesView } from "@/components/known-issues/known-issues-view";

export const metadata: Metadata = { title: "Known issues" };

export default function KnownIssuesPage() {
  return <KnownIssuesView />;
}
