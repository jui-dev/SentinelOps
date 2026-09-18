import type { Metadata } from "next";

import { AuthFrame } from "@/components/app/auth-frame";
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
    <AuthFrame width="md">
      <InvitationAcceptance />
    </AuthFrame>
  );
}
