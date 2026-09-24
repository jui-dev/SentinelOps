"use client";

import { MyOperations } from "@/components/my-operations/my-operations";
import { Permission } from "@/lib/api/contracts";

import { OrganizationOverview } from "./organization-overview";
import { useCan } from "./organization-scope";

/**
 * Where entering an organization lands, resolved by what the caller may see.
 *
 * `/orgs/[orgSlug]` is the one address for "I am in this organization" —
 * the picker's link, the rail's switcher, and the redirect from `/` all
 * point at it — so it answers each caller with the workspace that is theirs
 * rather than with one surface that half of them may not have.
 *
 * Oversight lands on the Overview: figures counted across every incident,
 * which the API answers only to `incidents:read-all`. Everyone else lands on
 * My Operations. The branch is made here rather than by redirecting, for
 * three reasons. It is how this app already handles a permission — rendering
 * what the grant affords, in place, as the Overview itself does for a caller
 * who may not read incidents at all. It leaves the navigation rail's own
 * Overview entry correct for both, still exact-matching this path. And it
 * means the organization-wide requests are never begun rather than begun and
 * abandoned: OperationsOverview is simply not mounted, and OrganizationScope
 * has already settled the caller's permissions before this renders, so there
 * is no first paint in which it could be.
 *
 * There is therefore no address at which the organization-wide Overview
 * renders for someone who may not see it. Nothing here is hidden — the API
 * refuses each of those aggregates with 403 on its own account.
 */
export function OrganizationLanding() {
  return useCan(Permission.INCIDENTS_READ_ALL) ? (
    <OrganizationOverview />
  ) : (
    <MyOperations />
  );
}
