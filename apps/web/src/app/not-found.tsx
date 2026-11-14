import type { Metadata } from "next";

import { AuthFrame } from "@/components/app/auth-frame";
import { NotFoundContent } from "@/components/app/fallback-pages";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Any address that names no page. Drawn in the sign-in frame, not the
 * workspace: whoever reaches it may not be signed in. A record that does
 * not exist — an incident, a member — is answered by its own page instead,
 * inside the workspace.
 */
export default function NotFound() {
  return (
    <AuthFrame>
      <NotFoundContent />
    </AuthFrame>
  );
}
