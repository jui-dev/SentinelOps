import type { Metadata } from "next";

import { AuthFrame } from "@/components/app/auth-frame";
import { InvitationAcceptance } from "@/components/invitations/invitation-acceptance";
import { InvitationsUnavailable } from "@/components/invitations/invitations-unavailable";
import { env } from "@/lib/config/env";

export const metadata: Metadata = {
  title: "Invitation",
  robots: { index: false, follow: false },
};

/**
 * Outside both route groups: it must work signed out, without `(app)`'s
 * redirect to login, and signed in, without `(auth)`'s redirect away.
 *
 * While invitations are switched off it only says so: the API has no
 * invitation routes for the acceptance flow to call.
 */
export default function InvitePage() {
  return (
    <AuthFrame width="md">
      {env.invitationsEnabled ? (
        <InvitationAcceptance />
      ) : (
        <InvitationsUnavailable />
      )}
    </AuthFrame>
  );
}
