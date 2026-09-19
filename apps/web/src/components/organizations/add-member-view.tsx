"use client";

import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Permission } from "@/lib/api/contracts";

import { AddMemberForm } from "./add-member-form";
import { membersHref } from "./members-view";
import { useCan, useOrganization } from "./organization-scope";

/**
 * Adding a member, on a page of its own: identity, a one-time password, and
 * optionally their teams. The way back to Members is the eyebrow above the
 * title, and Cancel beside the form's action.
 */
export function AddMemberView() {
  const organization = useOrganization();
  // Advice only: the API refuses anyone without members:manage regardless.
  const canAddMembers = useCan(Permission.MEMBERS_MANAGE);

  return (
    <>
      <PageHeader
        width="form"
        eyebrow={
          <Link
            href={membersHref(organization.slug)}
            className="rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            ← Members
          </Link>
        }
        title="Add member"
        description="Create their account as a Member, with a one-time password to hand them. They choose their own when they first sign in."
      />
      <PageBody width="form">
        {canAddMembers ? (
          <AddMemberForm />
        ) : (
          <Alert tone="info">
            Only the Admin can add members to this organization.
          </Alert>
        )}
      </PageBody>
    </>
  );
}
