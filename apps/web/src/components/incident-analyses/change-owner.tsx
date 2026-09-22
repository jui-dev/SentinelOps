"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { useMemberships } from "@/components/organizations/membership-list";
import { useOrganization } from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { RecordList, RecordRow } from "@/components/ui/record";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ApiErrorCode } from "@/lib/api/contracts";
import type {
  IncidentAnalysisResponse,
  IncidentDetailResponse,
} from "@/lib/api/contracts";
import { isApiError } from "@/lib/api/errors";

import {
  analysisRefusalOf,
  useReassignIncidentAnalysisOwner,
} from "./analysis-queries";
import { MEMBER_GONE, OWNER_HINT, OwnerOptions } from "./owner-options";

const CHANGED =
  "This analysis changed and has been refreshed. Check the owner and try again.";

/**
 * Handing the draft to another member. The current owner is shown and left
 * out of the choice. It is sent with the analysis as it now stands — the
 * version the page holds, refreshed after any refusal — and it changes no
 * text, so nothing the admin has typed is touched.
 */
function ChangeOwnerForm({
  analysis,
  incident,
  onClose,
}: {
  analysis: IncidentAnalysisResponse;
  incident: IncidentDetailResponse;
  onClose: () => void;
}) {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  const reassign = useReassignIncidentAnalysisOwner(organization.id, incident.number);
  const [chosen, setChosen] = useState("");

  if (memberships.isError) return <ErrorAlert error={memberships.error} />;
  if (!memberships.data) return <Spinner label="Loading members…" />;

  // A choice that is no longer a candidate — the refreshed analysis made
  // them the owner, or they left — is no choice.
  const ownerId = memberships.data.some(
    ({ id }) => id === chosen && id !== analysis.owner.membershipId,
  )
    ? chosen
    : "";

  const refusal = analysisRefusalOf(reassign.error);
  const memberGone =
    isApiError(reassign.error, 404) &&
    reassign.error.code === ApiErrorCode.MEMBERSHIP_NOT_FOUND;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!ownerId) return;

    reassign.mutate(
      { ownerMembershipId: ownerId, version: analysis.version },
      {
        onSuccess: onClose,
        onError: (error) => {
          // Published meanwhile: nothing is left to own, and the page shows it.
          if (analysisRefusalOf(error) === "published") onClose();
        },
      },
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {refusal === "changed" ? (
        <Alert tone="warning">{CHANGED}</Alert>
      ) : (
        reassign.isError && !memberGone && !refusal && <ErrorAlert error={reassign.error} />
      )}
      <RecordList>
        <RecordRow label="Current owner">{analysis.owner.name}</RecordRow>
      </RecordList>
      <Select
        label="New owner"
        name="ownerMembershipId"
        value={ownerId}
        onChange={(event) => setChosen(event.target.value)}
        hint={OWNER_HINT}
        error={memberGone ? MEMBER_GONE : undefined}
      >
        <option value="" disabled>
          Choose a member
        </option>
        <OwnerOptions
          incident={incident}
          memberships={memberships.data}
          me={organization.membership.id}
          exclude={analysis.owner.membershipId}
        />
      </Select>
      <DialogActions>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ownerId || reassign.isPending}>
          {reassign.isPending ? "Changing…" : "Change owner"}
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * Changing who owns a draft analysis: administration, not writing, so a
 * quiet control in the analysis's status line rather than among the
 * editor's actions. Only for whoever runs incidents' lifecycles; the caller
 * decides, and the API checks.
 */
export function ChangeOwner({
  analysis,
  incident,
}: {
  analysis: IncidentAnalysisResponse;
  incident: IncidentDetailResponse;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
        Change owner
      </Button>
      {open && (
        <FormDialog
          title="Change owner"
          description="The owner is accountable for writing and publishing this analysis."
          onClose={() => setOpen(false)}
        >
          <ChangeOwnerForm
            analysis={analysis}
            incident={incident}
            onClose={() => setOpen(false)}
          />
        </FormDialog>
      )}
    </>
  );
}
