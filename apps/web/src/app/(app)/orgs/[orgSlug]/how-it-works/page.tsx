import type { Metadata } from "next";

import { HowItWorksView } from "@/components/how-it-works/how-it-works-view";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorksRoute() {
  return <HowItWorksView />;
}
