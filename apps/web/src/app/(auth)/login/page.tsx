import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { PageSpinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  // The form reads `?next=`, so it renders on the client below this boundary.
  return (
    <Suspense fallback={<PageSpinner />}>
      <LoginForm />
    </Suspense>
  );
}
