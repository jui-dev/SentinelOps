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
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-start justify-center gap-4 px-4">
      <Alert title="SentinelOps is temporarily unreachable." className="w-full">
        <p className="text-fg-muted">
          Check your connection and try again. You have not been signed out.
        </p>
      </Alert>
      <Button onClick={retry}>Try again</Button>
    </div>
  );
}
