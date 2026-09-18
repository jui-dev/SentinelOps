"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Permission } from "@/lib/api/contracts";
import type { InvitationResponse } from "@/lib/api/contracts";
import { listInvitations, revokeInvitation } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { formatDate, formatRole } from "./format";
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
    <tr>
      <td className="px-4 py-2">{invitation.email}</td>
      <td className="px-4 py-2">{formatRole(invitation.role)}</td>
      <td className="px-4 py-2">
        {invitation.status === "expired" ? (
          <span className="text-amber-700">Expired</span>
        ) : (
          "Pending"
        )}
      </td>
      <td className="px-4 py-2 text-slate-600">{invitation.invitedBy.name}</td>
      <td className="px-4 py-2 text-slate-600">
        {formatDate(invitation.expiresAt)}
      </td>
      {canManage && (
        <td className="px-4 py-2 text-right">
          <Button
            variant="secondary"
            disabled={revoking}
            onClick={() => onRevoke(invitation.id)}
            aria-label={`Revoke invitation for ${invitation.email}`}
          >
            {revoking ? "Revoking…" : "Revoke"}
          </Button>
        </td>
      )}
    </tr>
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
  if (!invitations.data) return <Spinner label="Loading invitations…" />;

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
        <p className="text-sm text-slate-600">No open invitations.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Email</th>
                <th scope="col" className="px-4 py-2 font-medium">Role</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="px-4 py-2 font-medium">Invited by</th>
                <th scope="col" className="px-4 py-2 font-medium">Expires</th>
                {canManage && (
                  <th scope="col" className="px-4 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {invitations.data.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  canManage={canManage}
                  onRevoke={onRevoke}
                  revoking={revokingId === invitation.id}
                />
              ))}
            </tbody>
          </table>
        </div>
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
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Open invitations</h2>
      <OpenInvitations canManage={canManage} />
    </section>
  );
}
