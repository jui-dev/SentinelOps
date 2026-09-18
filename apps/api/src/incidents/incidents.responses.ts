import type { ServiceCriticality } from '../services/services.contract.js';
import type {
  IncidentActivityResponse,
  IncidentActivityType,
  IncidentDetailResponse,
  IncidentMemberResponse,
  IncidentResponse,
  IncidentSeverity,
  IncidentStatus,
} from './incidents.contract.js';

/**
 * Row-to-wire mapper for incidents. Same rules as auth.responses.ts: every
 * emitted field is named, nothing is spread from a row, and inputs are
 * structural rather than Prisma model types.
 */

interface IncidentRow {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  service: {
    id: string;
    name: string;
    slug: string;
    criticality: ServiceCriticality;
    archivedAt: Date | null;
  };
  team: { id: string; name: string; slug: string };
  createdBy: { id: string; name: string };
}

/** Embedded records are identity only — never a user's email or memberships. */
export const toIncidentResponse = (
  incident: IncidentRow,
): IncidentResponse => ({
  id: incident.id,
  number: incident.number,
  title: incident.title,
  summary: incident.summary,
  severity: incident.severity,
  status: incident.status,
  service: {
    id: incident.service.id,
    name: incident.service.name,
    slug: incident.service.slug,
    criticality: incident.service.criticality,
    archivedAt: incident.service.archivedAt?.toISOString() ?? null,
  },
  team: {
    id: incident.team.id,
    name: incident.team.name,
    slug: incident.team.slug,
  },
  createdBy: {
    id: incident.createdBy.id,
    name: incident.createdBy.name,
  },
  createdAt: incident.createdAt.toISOString(),
  updatedAt: incident.updatedAt.toISOString(),
  resolvedAt: incident.resolvedAt?.toISOString() ?? null,
});

interface IncidentMemberRow {
  id: string;
  user: { name: string };
}

interface IncidentDetailRow extends IncidentRow {
  lead: IncidentMemberRow | null;
  responders: { membership: IncidentMemberRow }[];
}

const toIncidentMemberResponse = (
  membership: IncidentMemberRow,
): IncidentMemberResponse => ({
  membershipId: membership.id,
  name: membership.user.name,
});

/** An incident with its lead and responders. */
export const toIncidentDetailResponse = (
  incident: IncidentDetailRow,
): IncidentDetailResponse => ({
  ...toIncidentResponse(incident),
  lead: incident.lead ? toIncidentMemberResponse(incident.lead) : null,
  responders: incident.responders.map(({ membership }) =>
    toIncidentMemberResponse(membership),
  ),
});

interface IncidentActivityRow {
  id: string;
  type: IncidentActivityType;
  message: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
  actor: { id: string; name: string };
}

/** One timeline entry. The actor is identity only — never an email. */
export const toIncidentActivityResponse = (
  activity: IncidentActivityRow,
): IncidentActivityResponse => ({
  id: activity.id,
  type: activity.type,
  message: activity.message,
  fromValue: activity.fromValue,
  toValue: activity.toValue,
  actor: {
    id: activity.actor.id,
    name: activity.actor.name,
  },
  createdAt: activity.createdAt.toISOString(),
});
