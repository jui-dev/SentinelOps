"use client";

import { AuthFrame } from "@/components/app/auth-frame";
import { ErrorContent } from "@/components/app/fallback-pages";

/**
 * An error outside an organization's pages — signing in, choosing an
 * organization — or in the workspace's own frame. In the sign-in frame,
 * since the workspace may be what failed.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <AuthFrame>
      <ErrorContent error={error} retry={retry} />
    </AuthFrame>
  );
}
