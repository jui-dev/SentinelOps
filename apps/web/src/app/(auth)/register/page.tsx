import type { Metadata } from "next";
import { Suspense } from "react";

import { RegisterForm } from "@/components/auth/register-form";
import { PageSpinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Create your organization" };

export default function RegisterPage() {
  return (
    <Suspense fallback={<PageSpinner size="panel" />}>
      <RegisterForm />
    </Suspense>
  );
}
