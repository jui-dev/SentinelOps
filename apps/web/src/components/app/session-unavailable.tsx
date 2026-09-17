"use client";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useSession } from "@/lib/auth/session-provider";

/**
 * Shown when the API could not be asked whether the session is valid. The
 * user is not signed out — the session may be fine — so the way on is a retry.
 */
export function SessionUnavailable() {
  const { retry } = useSession();

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-4">
      <Alert>
        SentinelOps is temporarily unreachable. Check your connection and try
        again.
      </Alert>
      <Button onClick={retry}>Try again</Button>
    </div>
  );
}
