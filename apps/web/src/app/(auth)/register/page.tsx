import type { Metadata } from "next";
import { Suspense } from "react";

import { RegisterForm } from "@/components/auth/register-form";
import { RegistrationClosed } from "@/components/auth/registration-closed";
import { PageSpinner } from "@/components/ui/spinner";
import { env } from "@/lib/config/env";

export const metadata: Metadata = { title: "Create your organization" };

/** While creating an organization is switched off, it only says so. */
export default function RegisterPage() {
  if (!env.registrationEnabled) return <RegistrationClosed />;

  return (
    <Suspense fallback={<PageSpinner size="panel" />}>
      <RegisterForm />
    </Suspense>
  );
}
