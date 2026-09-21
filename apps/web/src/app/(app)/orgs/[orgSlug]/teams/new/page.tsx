import type { Metadata } from "next";

import { NewTeamView } from "@/components/teams/new-team-view";

export const metadata: Metadata = { title: "New team" };

export default function NewTeamPage() {
  return <NewTeamView />;
}
