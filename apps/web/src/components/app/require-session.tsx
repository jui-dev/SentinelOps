"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { PageSpinner } from "@/components/ui/spinner";
import { useSession } from "@/lib/auth/session-provider";

import { SessionUnavailable } from "./session-unavailable";
import { StripFrame } from "./situation";
import { ThemeControl } from "./theme-control";

/**
 * The workspace's chrome before the workspace can render: the same strip, so
 * restoring a session looks like the product from the first paint rather
 * than a blank page the shell later pops into.
 */
function SessionFallback({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <StripFrame alignToRail trailing={<ThemeControl />} />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}

/**
 * Renders its children only for a signed-in user, and sends anyone else to
 * log in — remembering where they were headed, unless they just logged out.
 * After an explicit logout the next person to sign in on this browser should
 * not be sent back to the previous user's page.
 *
 * This is a convenience, not a control: nothing rendered here is fetched
 * without the API authenticating the request.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, signOutReason } = useSession();

  useEffect(() => {
    if (status !== "unauthenticated") return;

    router.replace(
      signOutReason === "logout"
        ? "/login"
        : `/login?next=${encodeURIComponent(pathname)}`,
    );
  }, [router, pathname, status, signOutReason]);

  if (status === "authenticated") return children;

  return (
    <SessionFallback>
      {status === "unavailable" ? <SessionUnavailable /> : <PageSpinner />}
    </SessionFallback>
  );
}
