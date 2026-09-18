import type { Metadata } from "next";

import { InvitationAcceptance } from "@/components/invitations/invitation-acceptance";

export const metadata: Metadata = {
  title: "Invitation",
  robots: { index: false, follow: false },
};

/**
 * Outside both route groups: it must work signed out, without `(app)`'s
 * redirect to login, and signed in, without `(auth)`'s redirect away.
 */
export default function InvitePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <p className="mb-6 text-lg font-semibold tracking-tight">SentinelOps</p>
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <InvitationAcceptance />
      </div>
    </main>
  );
}
