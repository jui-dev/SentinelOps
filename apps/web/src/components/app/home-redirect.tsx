"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { ErrorAlert } from "@/components/ui/alert";
import { PageSpinner } from "@/components/ui/spinner";
import { useCurrentUser, useSession } from "@/lib/auth/session-provider";

import { SessionUnavailable } from "./session-unavailable";

/**
 * `/` has no content of its own. It sends a signed-out visitor to log in, a
 * member of exactly one organization straight into it, and anyone else to
 * the organization picker.
 */
export function HomeRedirect() {
  const router = useRouter();
  const { status } = useSession();
  const me = useCurrentUser();

  const target =
    status === "unauthenticated"
      ? "/login"
      : me.data
        ? me.data.memberships.length === 1
          ? `/orgs/${encodeURIComponent(me.data.memberships[0].organization.slug)}`
          : "/orgs"
        : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

  if (status === "unavailable") return <SessionUnavailable />;
  if (me.isError) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <ErrorAlert error={me.error} />
      </div>
    );
  }

  return <PageSpinner />;
}
