import type { Metadata } from "next";
import { Suspense } from "react";

import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { PageSpinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Change password" };

// The form reads `?from=`, which is only known in the browser.
export default function ChangePasswordPage() {
  return (
    <Suspense fallback={<PageSpinner size="panel" />}>
      <ChangePasswordForm />
    </Suspense>
  );
}
