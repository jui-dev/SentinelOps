"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { organizationPath } from "@/components/app/navigation";
import { useOrganizationId } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody } from "@/components/ui/page";
import { PageSpinner } from "@/components/ui/spinner";
import type { ServiceResponse } from "@/lib/api/contracts";
import { listServices } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

export const servicesHref = (orgSlug: string) =>
  `${organizationPath(orgSlug)}/services`;

export const serviceHref = (orgSlug: string, serviceSlug: string) =>
  `${servicesHref(orgSlug)}/${encodeURIComponent(serviceSlug)}`;

/** The organization's services. Service pages read their service from this too. */
export const useServices = (organizationId: string) =>
  useQuery({
    queryKey: queryKeys.services(organizationId),
    queryFn: () => listServices(organizationId),
  });

/**
 * The service a page under `/services/[serviceSlug]` works on.
 *
 * URLs carry the slug; the API is addressed by id. The slug is resolved
 * against the organization's service list, as `TeamScope` resolves a team's,
 * which is stable because a service's slug never changes.
 */
const ServiceContext = createContext<ServiceResponse | null>(null);

/** The current service. Only valid inside `ServiceScope`. */
export const useService = (): ServiceResponse => {
  const service = useContext(ServiceContext);

  if (!service) {
    throw new Error("useService must be used within ServiceScope");
  }

  return service;
};

export function ServiceNotFound({ orgSlug }: { orgSlug: string }) {
  return (
    <PageBody width="form">
      <EmptyState
        className="mt-6"
        headingLevel={1}
        title="Service not found"
        action={
          <Link
            href={servicesHref(orgSlug)}
            className="text-sm font-medium text-accent-text underline-offset-2 hover:underline"
          >
            All services
          </Link>
        }
      >
        <p>It does not exist in this organization, or it was deleted.</p>
      </EmptyState>
    </PageBody>
  );
}

export function ServiceScope({ children }: { children: ReactNode }) {
  const { orgSlug, serviceSlug } = useParams<{
    orgSlug: string;
    serviceSlug: string;
  }>();
  const services = useServices(useOrganizationId());

  if (services.isError) {
    return (
      <PageBody width="form">
        <ErrorAlert error={services.error} />
      </PageBody>
    );
  }

  if (!services.data) return <PageSpinner />;

  const service = services.data.find(({ slug }) => slug === serviceSlug);

  if (!service) return <ServiceNotFound orgSlug={orgSlug} />;

  return (
    <ServiceContext.Provider value={service}>{children}</ServiceContext.Provider>
  );
}
