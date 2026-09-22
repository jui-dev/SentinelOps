import { incidentKey } from "@/components/incidents/severity";
import type {
  IncidentDetailResponse,
  OrganizationMembershipResponse,
} from "@/lib/api/contracts";

/** What owning an analysis means, beneath wherever its owner is chosen. */
export const OWNER_HINT =
  "The owner is responsible for writing and publishing it. Admins can edit any draft.";

/** The chosen owner left the organization before the choice was sent. */
export const MEMBER_GONE =
  "That person is no longer a member of this organization. The list of members has been refreshed.";

/**
 * Who can own an incident's analysis, as a select's options: those who
 * responded to the incident first — they know it best — then everyone
 * else, the caller marked as themselves. `exclude` leaves one out: the
 * owner already chosen, when choosing another.
 */
export function OwnerOptions({
  incident,
  memberships,
  me,
  exclude,
}: {
  incident: IncidentDetailResponse;
  memberships: readonly OrganizationMembershipResponse[];
  me: string;
  exclude?: string;
}) {
  const responded = new Set(
    incident.responders.map(({ membershipId }) => membershipId),
  );
  const candidates = memberships.filter(({ id }) => id !== exclude);
  const responders = candidates.filter(({ id }) => responded.has(id));
  const others = candidates.filter(({ id }) => !responded.has(id));

  const optionFor = (membership: OrganizationMembershipResponse) => (
    <option key={membership.id} value={membership.id}>
      {membership.id === me
        ? `${membership.user.name} (you)`
        : `${membership.user.name} (${membership.user.email})`}
    </option>
  );

  return responders.length > 0 ? (
    <>
      <optgroup label={`Responded to ${incidentKey(incident.number)}`}>
        {responders.map(optionFor)}
      </optgroup>
      <optgroup label="Everyone else">{others.map(optionFor)}</optgroup>
    </>
  ) : (
    <>{others.map(optionFor)}</>
  );
}
