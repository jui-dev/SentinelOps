"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "@/lib/auth/session-provider";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

/**
 * Leaves the login and register pages once a session exists, whether it was
 * restored on load or just created, for the `?next=` path if it is safe.
 * Components using this must sit inside a Suspense boundary: they read the
 * search params.
 */
export const useAuthRedirect = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const next = searchParams.get("next");
  const destination = safeRedirectPath(next);

  useEffect(() => {
    if (status === "authenticated") router.replace(destination);
  }, [router, status, destination]);

  return { status, next };
};
