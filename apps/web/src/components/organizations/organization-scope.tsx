"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";

import { ErrorAlert } from "@/components/ui/alert";
import { PageSpinner } from "@/components/ui/spinner";
import { Permission } from "@/lib/api/contracts";
import type { OrganizationDetailResponse } from "@/lib/api/contracts";
import { getOrganization } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { useCurrentUser } from "@/lib/auth/session-provider";

/**
 * The organization a page under `/orgs/[orgSlug]` works in.
 *
 * URLs carry the slug for readability; the API is addressed by id. The slug
 * is resolved against the caller's own memberships from `/auth/me`, so a slug
 * the caller does not belong to never produces a request at all.
 */
const OrganizationIdContext = createContext<string | null>(null);

export const organizationQuery = (organizationId: string) => ({
  queryKey: queryKeys.organization(organizationId),
  queryFn: () => getOrganization(organizationId),
});

/** The current organization's id. Only valid inside `OrganizationScope`. */
export const useOrganizationId = (): string => {
  const id = useContext(OrganizationIdContext);

  if (!id) {
    throw new Error("useOrganizationId must be used within OrganizationScope");
  }

  return id;
};

/**
 * The current organization with the caller's role and permissions. The scope
 * renders children only once this has loaded, so `data` is present.
 */
export const useOrganization = () => {
  const query = useQuery(organizationQuery(useOrganizationId()));

  return query.data as OrganizationDetailResponse;
};

/**
 * Whether the API says the caller may do `permission` here. Advice for what
 * to offer, not enforcement — the API checks every request itself.
 */
export const useCan = (permission: string): boolean =>
  useOrganization().membership.permissions.includes(permission);

export function OrganizationNotFound() {
  return (
    <section className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Organization not found</h1>
      <p className="text-sm text-slate-600">
        It does not exist, or you are not a member of it.
      </p>
      <Link href="/orgs" className="text-sm font-medium underline">
        Your organizations
      </Link>
    </section>
  );
}

function OrganizationTabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  const canUpdate = useCan(Permission.ORGANIZATION_UPDATE);
  const base = `/orgs/${encodeURIComponent(slug)}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/members`, label: "Members" },
    ...(canUpdate ? [{ href: `${base}/settings`, label: "Settings" }] : []),
  ];

  return (
    <nav aria-label="Organization" className="flex gap-1 border-b border-slate-200">
      {tabs.map(({ href, label }) => {
        const current = pathname === href;

        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              current
                ? "border-slate-900 font-medium text-slate-900"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function OrganizationLoaded({
  organizationId,
  slug,
  children,
}: {
  organizationId: string;
  slug: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const organization = useQuery(organizationQuery(organizationId));
  const vanished = isApiError(organization.error, 404);

  // The API no longer admits the caller — membership revoked, organization
  // deleted — though `me` still listed it. Refresh `me` so the picker and
  // switcher stop offering it.
  useEffect(() => {
    if (vanished) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me, exact: true });
    }
  }, [vanished, queryClient]);

  if (vanished) return <OrganizationNotFound />;
  if (organization.isError) return <ErrorAlert error={organization.error} />;
  if (!organization.data) return <PageSpinner />;

  return (
    <OrganizationIdContext.Provider value={organizationId}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold">{organization.data.name}</h1>
          <OrganizationTabs slug={slug} />
        </div>
        {children}
      </div>
    </OrganizationIdContext.Provider>
  );
}

/** A malformed escape in the URL names no organization; it must not throw. */
const decodeSegment = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

export function OrganizationScope({ children }: { children: ReactNode }) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const me = useCurrentUser();

  if (me.isError) return <ErrorAlert error={me.error} />;
  if (!me.data) return <PageSpinner />;

  const slug = decodeSegment(orgSlug);
  const membership =
    slug === null
      ? undefined
      : me.data.memberships.find(
          ({ organization }) => organization.slug === slug,
        );

  if (!membership) return <OrganizationNotFound />;

  return (
    <OrganizationLoaded
      key={membership.organization.id}
      organizationId={membership.organization.id}
      slug={membership.organization.slug}
    >
      {children}
    </OrganizationLoaded>
  );
}
