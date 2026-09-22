"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { incidentKey } from "@/components/incidents/severity";
import { useMemberships } from "@/components/organizations/membership-list";
import { useOrganization } from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ApiErrorCode } from "@/lib/api/contracts";
import type {
  IncidentDetailResponse,
  OrganizationMembershipResponse,
} from "@/lib/api/contracts";
import { isApiError } from "@/lib/api/errors";

import {
  analysisRefusalOf,
  incidentAnalysisHref,
  useStartIncidentAnalysis,
} from "./analysis-queries";

const MEMBER_GONE =
  "That person is no longer a member of this organization. The list of members has been refreshed.";

/**
 * Choosing who owns the analysis, and starting it. The caller owns it unless
 * they choose someone else — then nothing is sent, and the API makes them
 * the owner. Those who responded to the incident come first: they know it
 * best. Started, the analysis is already in the cache, so its page opens at
 * once.
 */
function StartAnalysisForm({
  incident,
  onCancel,
}: {
  incident: IncidentDetailResponse;
  onCancel: () => void;
}) {
  const organization = useOrganization();
  const router = useRouter();
  const memberships = useMemberships(organization.id);
  const start = useStartIncidentAnalysis(organization.id, incident.number);
  const me = organization.membership.id;
  const [ownerId, setOwnerId] = useState(me);

  if (memberships.isError) return <ErrorAlert error={memberships.error} />;
  if (!memberships.data) return <Spinner label="Loading members…" />;

  const responded = new Set(
    incident.responders.map(({ membershipId }) => membershipId),
  );
  const responders = memberships.data.filter(({ id }) => responded.has(id));
  const others = memberships.data.filter(({ id }) => !responded.has(id));

  const optionFor = (membership: OrganizationMembershipResponse) => (
    <option key={membership.id} value={membership.id}>
      {membership.id === me
        ? `${membership.user.name} (you)`
        : `${membership.user.name} (${membership.user.email})`}
    </option>
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    start.mutate(ownerId === me ? undefined : { ownerMembershipId: ownerId }, {
      onSuccess: () =>
        router.push(incidentAnalysisHref(organization.slug, incident.number)),
    });
  };

  // Someone else was first: theirs has been fetched, and is on the page.
  if (analysisRefusalOf(start.error) === "already-started") {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info">
          Someone else started this analysis a moment ago. It has been
          refreshed.
        </Alert>
        <DialogActions>
          <Button onClick={onCancel}>Done</Button>
        </DialogActions>
      </div>
    );
  }

  const memberGone =
    isApiError(start.error, 404) &&
    start.error.code === ApiErrorCode.MEMBERSHIP_NOT_FOUND;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {start.isError && !memberGone && <ErrorAlert error={start.error} />}
      <Select
        label="Owner"
        name="ownerMembershipId"
        value={ownerId}
        onChange={(event) => setOwnerId(event.target.value)}
        hint="The owner is responsible for writing and publishing it. Admins can edit any draft."
        error={memberGone ? MEMBER_GONE : undefined}
      >
        {responders.length > 0 ? (
          <>
            <optgroup label={`Responded to ${incidentKey(incident.number)}`}>
              {responders.map(optionFor)}
            </optgroup>
            <optgroup label="Everyone else">{others.map(optionFor)}</optgroup>
          </>
        ) : (
          others.map(optionFor)
        )}
      </Select>
      <DialogActions>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={start.isPending}>
          {start.isPending ? "Starting…" : "Start analysis"}
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * Starting a resolved incident's analysis: a button, and the dialog it
 * opens. Only for whoever may start one — the caller decides; the API
 * checks.
 */
export function StartAnalysis({
  incident,
}: {
  incident: IncidentDetailResponse;
}) {
  const [starting, setStarting] = useState(false);

  return (
    <>
      <Button onClick={() => setStarting(true)}>Start analysis</Button>
      {starting && (
        <FormDialog
          title="Start analysis"
          description={`${incidentKey(incident.number)} is resolved. Its analysis starts as a draft, which the owner writes and publishes.`}
          onClose={() => setStarting(false)}
        >
          <StartAnalysisForm
            incident={incident}
            onCancel={() => setStarting(false)}
          />
        </FormDialog>
      )}
    </>
  );
}
