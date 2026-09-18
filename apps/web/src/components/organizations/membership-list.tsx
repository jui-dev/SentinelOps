"use client";

import { useQuery } from "@tanstack/react-query";

import { ErrorAlert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { IsoDate } from "@/components/ui/timestamp";
import { listMemberships } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { useCurrentUser } from "@/lib/auth/session-provider";

import { formatRole } from "./format";
import { useOrganizationId } from "./organization-scope";

export const useMemberships = (organizationId: string) =>
  useQuery({
    queryKey: queryKeys.memberships(organizationId),
    queryFn: () => listMemberships(organizationId),
  });

export function MembershipList() {
  const organizationId = useOrganizationId();
  const memberships = useMemberships(organizationId);
  const me = useCurrentUser();

  if (memberships.isError) return <ErrorAlert error={memberships.error} />;
  if (!memberships.data) return <Spinner label="Loading members…" />;

  return (
    <Table label="Members">
      <THead>
        <TR>
          <TH>Name</TH>
          <TH className="hidden sm:table-cell">Email</TH>
          <TH>Role</TH>
          <TH className="hidden sm:table-cell">Joined</TH>
        </TR>
      </THead>
      <TBody>
        {memberships.data.map((membership) => (
          <TR key={membership.id}>
            <TD>
              <span className="font-medium">{membership.user.name}</span>
              {membership.user.id === me.data?.id && (
                <span className="ml-2 text-xs text-fg-subtle">You</span>
              )}
              {/* On narrow screens the email folds under the name. */}
              <span className="block truncate text-xs text-fg-muted sm:hidden">
                {membership.user.email}
              </span>
            </TD>
            <TD kind="muted" className="hidden sm:table-cell">
              {membership.user.email}
            </TD>
            <TD kind="muted">{formatRole(membership.role)}</TD>
            <TD kind="data" className="hidden sm:table-cell">
              <IsoDate value={membership.createdAt} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
