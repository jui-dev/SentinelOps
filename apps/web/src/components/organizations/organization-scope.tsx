"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";

import { ErrorAlert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody } from "@/components/ui/page";
import { PageSpinner } from "@/components/ui/spinner";
import type {
  MembershipResponse,
  OrganizationDetailResponse,
} from "@/lib/api/contracts";
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

/** A malformed escape in the URL names no organization; it must not throw. */
const decodeSegment = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/** The caller's membership whose organization has this URL segment as slug. */
export const findMembershipBySlug = (
  memberships: MembershipResponse[],
  segment: string,
): MembershipResponse | undefined => {
  const slug = decodeSegment(segment);

  return slug === null
    ? undefined
    : memberships.find(({ organization }) => organization.slug === slug);
};

/**
 * The caller's membership in the organization the current route names, or
 * `undefined` outside an organization route, while `me` loads, or when the
 * slug is not one of theirs. For chrome outside the scope — the navigation
 * rail and the situation strip — which must agree with it.
 */
export const useRouteMembership = (): MembershipResponse | undefined => {
  const { orgSlug } = useParams<{ orgSlug?: string }>();
  const me = useCurrentUser();

  return orgSlug && me.data
    ? findMembershipBySlug(me.data.memberships, orgSlug)
    : undefined;
};

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
    <PageBody width="form">
      <EmptyState
        className="mt-6"
        headingLevel={1}
        title="Organization not found"
        action={
          <Link
            href="/orgs"
            className="text-sm font-medium text-accent-text underline-offset-2 hover:underline"
          >
            Your organizations
          </Link>
        }
      >
        <p>
          It does not exist, or you are not a member of it. If you were
          removed or the link is old, ask an organization admin for access.
        </p>
      </EmptyState>
    </PageBody>
  );
}

function ScopeError({ error }: { error: unknown }) {
  return (
    <PageBody width="form">
      <ErrorAlert error={error} />
    </PageBody>
  );
}

function OrganizationLoaded({
  organizationId,
  children,
}: {
  organizationId: string;
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
  if (organization.isError) return <ScopeError error={organization.error} />;
  if (!organization.data) return <PageSpinner />;

  return (
    <OrganizationIdContext.Provider value={organizationId}>
      {children}
    </OrganizationIdContext.Provider>
  );
}

export function OrganizationScope({ children }: { children: ReactNode }) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const me = useCurrentUser();

  if (me.isError) return <ScopeError error={me.error} />;
  if (!me.data) return <PageSpinner />;

  const membership = findMembershipBySlug(me.data.memberships, orgSlug);

  if (!membership) return <OrganizationNotFound />;

  return (
    <OrganizationLoaded
      key={membership.organization.id}
      organizationId={membership.organization.id}
    >
      {children}
    </OrganizationLoaded>
  );
}
