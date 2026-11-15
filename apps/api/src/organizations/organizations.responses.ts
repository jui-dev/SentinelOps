import { toOrganizationResponse } from '../auth/auth.responses.js';
import { permissionsFor } from '../authorization/role-permissions.js';
import type { Role } from '../generated/prisma/enums.js';
import type {
  MemberOpenWorkResponse,
  OrganizationDetailResponse,
  OrganizationMembershipResponse,
} from './organizations.contract.js';

/**
 * Row-to-wire mappers for organization-scoped reads. Same rules as
 * auth.responses.ts: every emitted field is named, nothing is spread from a
 * row, and inputs are structural rather than Prisma model types.
 */

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  isDemo: boolean;
}

interface CallerMembership {
  membershipId: string;
  role: Role;
}

interface MembershipRow {
  id: string;
  role: string;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    passwordChangeRequired: boolean;
  };
  teamMemberships: {
    team: { id: string; name: string; slug: string };
  }[];
  removedAt: Date | null;
  removedBy: { id: string; name: string } | null;
  /** Selected only for a reader who manages members. */
  incidentResponses?: { incident: IncidentRef }[];
  analysesOwned?: { incident: IncidentRef }[];
}

interface IncidentRef {
  number: number;
  title: string;
}

const openWorkOf = (membership: MembershipRow): MemberOpenWorkResponse[] =>
  [
    ...(membership.incidentResponses ?? []).map(({ incident }) => ({
      kind: 'INVESTIGATING' as const,
      incident,
    })),
    ...(membership.analysesOwned ?? []).map(({ incident }) => ({
      kind: 'DRAFT_ANALYSIS' as const,
      incident,
    })),
  ].map(({ kind, incident }) => ({
    kind,
    incident: { number: incident.number, title: incident.title },
  }));

export const toOrganizationDetailResponse = (
  organization: OrganizationRow,
  caller: CallerMembership,
): OrganizationDetailResponse => ({
  ...toOrganizationResponse(organization),
  membership: {
    id: caller.membershipId,
    role: caller.role,
    permissions: permissionsFor(caller.role),
  },
});

/**
 * Never emits the user's password hash, deletion state, or other
 * memberships. Teams are identity only, in the order they were selected.
 */
export const toOrganizationMembershipResponse = (
  membership: MembershipRow,
  /** Whether the reader sets accounts up, and so is told how far each is. */
  { accountSetup }: { accountSetup: boolean },
): OrganizationMembershipResponse => ({
  id: membership.id,
  role: membership.role,
  createdAt: membership.createdAt.toISOString(),
  user: {
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    ...(accountSetup && {
      passwordChangeRequired: membership.user.passwordChangeRequired,
    }),
  },
  teams: membership.teamMemberships.map(({ team }) => ({
    id: team.id,
    name: team.name,
    slug: team.slug,
  })),
  ...(accountSetup && {
    removal: membership.removedAt
      ? {
          removedAt: membership.removedAt.toISOString(),
          removedBy: membership.removedBy
            ? { id: membership.removedBy.id, name: membership.removedBy.name }
            : null,
        }
      : null,
    openWork: openWorkOf(membership),
  }),
});
