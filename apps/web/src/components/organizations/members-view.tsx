"use client";

import Link from "next/link";
import { useState } from "react";

import { teamsHref } from "@/components/teams/team-scope";
import { Button } from "@/components/ui/button";
import { EmptyNote } from "@/components/ui/empty-state";
import { linkClasses } from "@/components/ui/link";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Permission } from "@/lib/api/contracts";

import { AddMemberDialog } from "./add-member-form";
import { MembershipList, useMemberships } from "./membership-list";
import { useCan, useOrganization } from "./organization-scope";

/**
 * The organization's people, at a glance: who they are, their role, the
 * teams they are on, and who has yet to sign in for the first time. Adding
 * someone is a dialog opened from the header; invitations are not offered
 * while they are switched off.
 */
export function MembersView() {
  const organization = useOrganization();
  // The whole directory is the Admin's. A member reaching this address is
  // pointed to their teams, where their teammates are — nothing is asked.
  const canReadEveryone = useCan(Permission.MEMBERSHIPS_READ_ALL);

  if (!canReadEveryone) {
    return (
      <>
        <PageHeader width="full" title="Members" />
        <PageBody width="full">
          <EmptyNote title="Your teammates are on your teams' pages">
            Each of your teams lists who is on it.{" "}
            <Link href={teamsHref(organization.slug)} className={linkClasses}>
              Go to Teams
            </Link>
            .
          </EmptyNote>
        </PageBody>
      </>
    );
  }

  return <Directory />;
}

function Directory() {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  // Advice only, like every useCan: the API authorizes adding regardless.
  const canAddMembers = useCan(Permission.MEMBERS_MANAGE);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        width="full"
        title="Members"
        meta={memberships.data?.length}
        description={
          <>
            Everyone in {organization.name}, you included, grouped by role.
            A role decides what someone can do; their teams decide which
            incidents.
          </>
        }
        actions={
          canAddMembers && (
            <Button onClick={() => setAdding(true)}>Add member</Button>
          )
        }
      />
      <PageBody width="full">
        <MembershipList />
      </PageBody>
      {canAddMembers && adding && (
        <AddMemberDialog onClose={() => setAdding(false)} />
      )}
    </>
  );
}
