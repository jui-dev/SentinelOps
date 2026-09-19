import Link from "next/link";

import { AuthHeading } from "@/components/auth/auth-heading";
import { linkClasses } from "@/components/ui/link";

/**
 * What `/invite` shows while invitations are switched off. Someone holding an
 * old link is told plainly how people join instead, rather than meeting a
 * form that could never succeed.
 */
export function InvitationsUnavailable() {
  return (
    <div className="flex flex-col gap-4">
      <AuthHeading
        title="Invitations aren't available"
        description="This workspace doesn't use invitation links. An admin adds people directly and gives them a one-time password to sign in with."
      />
      <p className="text-sm text-fg-muted">
        Already have your sign-in details?{" "}
        <Link href="/login" className={linkClasses}>
          Log in
        </Link>
      </p>
    </div>
  );
}
