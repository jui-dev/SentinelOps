"use client";

import { useQuery } from "@tanstack/react-query";

import { ErrorAlert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { listMemberships } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

import { formatDate, formatRole } from "./format";
import { useOrganizationId } from "./organization-scope";

export function MembershipList() {
  const organizationId = useOrganizationId();
  const memberships = useQuery({
    queryKey: queryKeys.memberships(organizationId),
    queryFn: () => listMemberships(organizationId),
  });

  if (memberships.isError) return <ErrorAlert error={memberships.error} />;
  if (!memberships.data) return <Spinner label="Loading members…" />;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">
        Members{" "}
        <span className="text-sm font-normal text-slate-500">
          ({memberships.data.length})
        </span>
      </h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Name</th>
              <th scope="col" className="px-4 py-2 font-medium">Email</th>
              <th scope="col" className="px-4 py-2 font-medium">Role</th>
              <th scope="col" className="px-4 py-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {memberships.data.map((membership) => (
              <tr key={membership.id}>
                <td className="px-4 py-2">{membership.user.name}</td>
                <td className="px-4 py-2 text-slate-600">
                  {membership.user.email}
                </td>
                <td className="px-4 py-2">{formatRole(membership.role)}</td>
                <td className="px-4 py-2 text-slate-600">
                  {formatDate(membership.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
