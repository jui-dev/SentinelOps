import Link from "next/link";

import { AuthHeading } from "@/components/auth/auth-heading";
import { linkClasses } from "@/components/ui/link";

/**
 * What `/register` shows while creating an organization is switched off.
 * Someone who reaches it is told how people join instead, rather than
 * meeting a form the API would refuse.
 */
export function RegistrationClosed() {
  return (
    <div className="flex flex-col gap-4">
      <AuthHeading
        title="Sign-up is closed"
        description="New organizations are set up by whoever runs SentinelOps. To join an existing one, ask its Admin to add you: they'll give you a one-time password to sign in with."
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
