"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useCurrentUser, useSession } from "@/lib/auth/session-provider";

function OrganizationSwitcher() {
  const router = useRouter();
  const params = useParams<{ orgSlug?: string }>();
  const me = useCurrentUser();
  const memberships = me.data?.memberships ?? [];

  if (memberships.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Organization</span>
      <select
        value={params.orgSlug ?? ""}
        onChange={(event) =>
          router.push(
            event.target.value
              ? `/orgs/${encodeURIComponent(event.target.value)}`
              : "/orgs",
          )
        }
        className="max-w-48 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
      >
        {!params.orgSlug && <option value="">Choose organization…</option>}
        {memberships.map(({ organization }) => (
          <option key={organization.id} value={organization.slug}>
            {organization.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { logout } = useSession();
  const me = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);

  // RequireSession navigates to /login once the session is gone.
  const onLogout = async () => {
    setSigningOut(true);

    try {
      await logout();
    } catch {
      // Local state is already cleared; see SessionProvider.logout.
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            SentinelOps
          </Link>
          <OrganizationSwitcher />
          <div className="ml-auto flex items-center gap-3">
            {me.data && (
              <span className="text-sm text-slate-600">{me.data.name}</span>
            )}
            <Button variant="secondary" onClick={onLogout} disabled={signingOut}>
              {signingOut ? "Logging out…" : "Log out"}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
