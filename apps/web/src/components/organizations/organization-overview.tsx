"use client";

import { formatDate, formatRole } from "./format";
import { useOrganization } from "./organization-scope";

export function OrganizationOverview() {
  const organization = useOrganization();

  return (
    <dl className="grid max-w-xl grid-cols-[max-content_1fr] gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <dt className="text-slate-500">URL name</dt>
      <dd>
        <code>{organization.slug}</code>
      </dd>
      <dt className="text-slate-500">Your role</dt>
      <dd>{formatRole(organization.membership.role)}</dd>
      <dt className="text-slate-500">Created</dt>
      <dd>{formatDate(organization.createdAt)}</dd>
    </dl>
  );
}
