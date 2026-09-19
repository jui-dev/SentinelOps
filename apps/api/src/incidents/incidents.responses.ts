import type { ServiceCriticality } from '../services/services.contract.js';
import type { Attention } from './incidents.attention.js';
import type {
  AffectedServiceResponse,
  IncidentActivityResponse,
  IncidentActivityType,
  IncidentAttentionResponse,
  IncidentDetailResponse,
  IncidentResponderStatus,
  IncidentResponse,
  IncidentSeverity,
  IncidentStatus,
  IncidentSummaryResponse,
  SeverityCounts,
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

interface IncidentResponderRow {
  status: IncidentResponderStatus;
  startedAt: Date;
  completedAt: Date | null;
  membership: { id: string; user: { name: string } };
}

interface IncidentDetailRow extends IncidentRow {
  responders: IncidentResponderRow[];
}

/** An incident with its responders, identity only — never an email. */
export const toIncidentDetailResponse = (
  incident: IncidentDetailRow,
): IncidentDetailResponse => ({
  ...toIncidentResponse(incident),
  responders: incident.responders.map((responder) => ({
    membershipId: responder.membership.id,
    name: responder.membership.user.name,
    status: responder.status,
    startedAt: responder.startedAt.toISOString(),
    completedAt: responder.completedAt?.toISOString() ?? null,
  })),
});

/** The caller's attention, each incident as the single-incident routes return it. */
export const toIncidentAttentionResponse = (
  attention: Attention<IncidentDetailRow>,
): IncidentAttentionResponse => ({
  manage: attention.manage && {
    readyToResolve: attention.manage.readyToResolve.map(
      toIncidentDetailResponse,
    ),
  },
  respond: attention.respond && {
    needsYourTeam: attention.respond.needsYourTeam.map(
      toIncidentDetailResponse,
    ),
    yourResponses: attention.respond.yourResponses.map(
      toIncidentDetailResponse,
    ),
  },
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

/** Most severe first, as the database enum declares them. */
const SEVERITIES: readonly IncidentSeverity[] = [
  'SEV1',
  'SEV2',
  'SEV3',
  'SEV4',
];

/** Most critical first: the order affected services are shown in. */
const CRITICALITIES: readonly ServiceCriticality[] = [
  'CRITICAL',
  'HIGH',
  'NORMAL',
  'LOW',
];

/** One group of incidents counted by severity, as `groupBy` returns it. */
interface SeverityCountRow {
  severity: IncidentSeverity;
  _count: { _all: number };
}

interface ActiveCountRow extends SeverityCountRow {
  serviceId: string;
}

interface AffectedServiceRow {
  id: string;
  name: string;
  slug: string;
  criticality: ServiceCriticality;
  archivedAt: Date | null;
  ownerTeam: { id: string; name: string; slug: string };
}

/** Every level present, each summed over the rows that carry it. */
const countBySeverity = (rows: readonly SeverityCountRow[]): SeverityCounts => {
  const counts: SeverityCounts = { SEV1: 0, SEV2: 0, SEV3: 0, SEV4: 0 };

  for (const row of rows) counts[row.severity] += row._count._all;

  return counts;
};

const total = (counts: SeverityCounts): number =>
  SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);

/**
 * The summary, from the rows its queries return. `active` is grouped by
 * service and severity, which gives both the organization's active counts
 * and each affected service's. Services are ordered by their most severe
 * active incident, then by criticality, then by name.
 */
export const toIncidentSummaryResponse = ({
  active,
  services,
  declared,
  resolved,
  stillOpen,
  period,
  history,
}: {
  active: readonly ActiveCountRow[];
  services: readonly AffectedServiceRow[];
  declared: readonly SeverityCountRow[];
  resolved: number;
  stillOpen: number;
  period: { from: string; to: string };
  history: {
    total: number;
    items: readonly {
      incident: IncidentRow;
      declaredInPeriod: boolean;
      resolvedInPeriod: boolean;
    }[];
  };
}): IncidentSummaryResponse => {
  const activeBySeverity = countBySeverity(active);
  const declaredBySeverity = countBySeverity(declared);

  const affectedServices = services
    .map((service): AffectedServiceResponse | undefined => {
      const rows = active.filter((row) => row.serviceId === service.id);
      const worstSeverity = SEVERITIES.find((severity) =>
        rows.some((row) => row.severity === severity),
      );

      if (!worstSeverity) return undefined;

      return {
        id: service.id,
        name: service.name,
        slug: service.slug,
        criticality: service.criticality,
        archivedAt: service.archivedAt?.toISOString() ?? null,
        ownerTeam: {
          id: service.ownerTeam.id,
          name: service.ownerTeam.name,
          slug: service.ownerTeam.slug,
        },
        activeIncidents: total(countBySeverity(rows)),
        worstSeverity,
      };
    })
    .filter((service) => service !== undefined)
    .sort(
      (a, b) =>
        SEVERITIES.indexOf(a.worstSeverity) -
          SEVERITIES.indexOf(b.worstSeverity) ||
        CRITICALITIES.indexOf(a.criticality) -
          CRITICALITIES.indexOf(b.criticality) ||
        a.name.localeCompare(b.name),
    );

  return {
    current: {
      active: total(activeBySeverity),
      activeBySeverity,
      affectedServices,
    },
    period: {
      from: period.from,
      to: period.to,
      declared: total(declaredBySeverity),
      declaredBySeverity,
      resolved,
      stillOpen,
      history: {
        total: history.total,
        items: history.items.map((item) => ({
          incident: toIncidentResponse(item.incident),
          declaredInPeriod: item.declaredInPeriod,
          resolvedInPeriod: item.resolvedInPeriod,
        })),
      },
    },
  };
};
