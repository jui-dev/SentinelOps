import { OrganizationLanding } from "@/components/organizations/organization-landing";

/**
 * No title of its own: what this page is depends on who opens it, and static
 * metadata is settled on the server, before any caller's permissions are
 * known. "SentinelOps" for both is better than "Overview" for someone
 * reading My Operations. The heading on the page says which it is.
 */
export default function OrganizationLandingPage() {
  return <OrganizationLanding />;
}
