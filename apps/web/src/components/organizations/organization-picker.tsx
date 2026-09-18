"use client";

import Link from "next/link";

import { organizationPath } from "@/components/app/navigation";
import { ErrorAlert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { PageSpinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useCurrentUser } from "@/lib/auth/session-provider";

import { formatRole } from "./format";

export function OrganizationPicker() {
  const me = useCurrentUser();

  if (me.isError) {
    return (
      <PageBody width="form">
        <ErrorAlert error={me.error} />
      </PageBody>
    );
  }
  if (!me.data) return <PageSpinner />;

  const { memberships } = me.data;

  return (
    <>
      <PageHeader
        title="Your organizations"
        meta={memberships.length > 0 ? memberships.length : undefined}
        description="Each organization keeps its own members, permissions, and records."
      />
      <PageBody>
        {memberships.length === 0 ? (
          <EmptyState title="You are not a member of any organization.">
            <p>
              To join one, open an invitation link from one of its admins.
            </p>
          </EmptyState>
        ) : (
          <Table label="Your organizations">
            <THead>
              <TR>
                <TH>Organization</TH>
                <TH>URL name</TH>
                <TH>Your role</TH>
              </TR>
            </THead>
            <TBody>
              {memberships.map(({ id, role, organization }) => (
                <TR key={id}>
                  <TD>
                    <Link
                      href={organizationPath(organization.slug)}
                      className="font-medium text-fg underline-offset-2 hover:text-accent-text hover:underline"
                    >
                      {organization.name}
                    </Link>
                  </TD>
                  <TD kind="data">{organization.slug}</TD>
                  <TD kind="muted">{formatRole(role)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </PageBody>
    </>
  );
}
