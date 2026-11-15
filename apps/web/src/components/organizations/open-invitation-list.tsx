"use client";

import {
  Ban,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyNote } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/page";
import { ListLoading } from "@/components/ui/spinner";
import { Status } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { IsoDate } from "@/components/ui/timestamp";
import { Permission } from "@/lib/api/contracts";
import type { InvitationResponse } from "@/lib/api/contracts";
import { listInvitations, revokeInvitation } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { formatRole } from "./format";
import { useCan, useOrganizationId } from "./organization-scope";

/**
 * Revokes an invitation. Stales the open-invitation list only. A 404 or 409
 * means the list was already out of date — the invitation was accepted,
 * revoked, or replaced meanwhile — so the list is refreshed then as well.
 */
export const useRevokeInvitation = (organizationId: string) => {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.invitations(organizationId),
      exact: true,
    });

  return useMutation({
    mutationFn: (invitationId: string) =>
      revokeInvitation(organizationId, invitationId),
    onSuccess: () => {
      void invalidate();
    },
    onError: (error) => {
      if (isApiError(error, 404) || isApiError(error, 409)) {
        void invalidate();
      }
    },
  });
};

const staleMessage =
  "That invitation was no longer open — it may have been accepted, revoked, or replaced. The list has been refreshed.";

function InvitationRow({
  invitation,
  canManage,
  onRevoke,
  revoking,
}: {
  invitation: InvitationResponse;
  canManage: boolean;
  onRevoke: (id: string) => void;
  revoking: boolean;
}) {
  return (
    <TR>
      <TD className="font-medium">{invitation.email}</TD>
      <TD kind="muted">{formatRole(invitation.role)}</TD>
      <TD>
        {invitation.status === "expired" ? (
          <Status tone="warning">Expired</Status>
        ) : (
          <Status tone="neutral">Pending</Status>
        )}
      </TD>
      <TD kind="muted" className="hidden md:table-cell">
        {invitation.invitedBy.name}
      </TD>
      <TD kind="data">
        <IsoDate value={invitation.expiresAt} />
      </TD>
      {canManage && (
        <TD kind="actions">
          <Button icon={Ban}
            variant="destructive"
            size="sm"
            disabled={revoking}
            onClick={() => onRevoke(invitation.id)}
            aria-label={`Revoke invitation for ${invitation.email}`}
          >
            {revoking ? "Revoking…" : "Revoke"}
          </Button>
        </TD>
      )}
    </TR>
  );
}

function OpenInvitations({ canManage }: { canManage: boolean }) {
  const organizationId = useOrganizationId();
  const invitations = useQuery({
    queryKey: queryKeys.invitations(organizationId),
    queryFn: () => listInvitations(organizationId),
  });
  const revoke = useRevokeInvitation(organizationId);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const onRevoke = (invitationId: string) => {
    setRevokingId(invitationId);
    revoke.mutate(invitationId, { onSettled: () => setRevokingId(null) });
  };

  if (invitations.isError) return <ErrorAlert error={invitations.error} />;
  if (!invitations.data) return <ListLoading label="Loading invitations…" />;

  const stale = isApiError(revoke.error, 404) || isApiError(revoke.error, 409);

  return (
    <>
      {revoke.isError &&
        (stale ? (
          <Alert tone="info">{staleMessage}</Alert>
        ) : (
          <ErrorAlert error={revoke.error} />
        ))}
      {invitations.data.length === 0 ? (
        <EmptyNote title="No open invitations">
          New invitations are listed here until they are accepted or revoked.
        </EmptyNote>
      ) : (
        <Table label="Open invitations"
          columns={[
            "main",
            "label",
            "status",
            { kind: "person", from: "md" },
            "date",
            ...(canManage ? ["actions" as const] : []),
          ]}
        >
          <THead>
            <TR>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH className="hidden md:table-cell">Invited by</TH>
              <TH>Expires</TH>
              {canManage && (
                <TH align="end">Actions</TH>
              )}
            </TR>
          </THead>
          <TBody>
            {invitations.data.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                canManage={canManage}
                onRevoke={onRevoke}
                revoking={revokingId === invitation.id}
              />
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}

/**
 * The organization's open invitations. Shown only when the API reports
 * `invitations:read`, with Revoke only for `invitations:manage` — as advice;
 * the API authorizes both regardless.
 */
export function OpenInvitationList() {
  const canRead = useCan(Permission.INVITATIONS_READ);
  const canManage = useCan(Permission.INVITATIONS_MANAGE);

  if (!canRead) return null;

  return (
    <Section title="Open invitations" level={3}>
      <OpenInvitations canManage={canManage} />
    </Section>
  );
}
