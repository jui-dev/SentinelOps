import type { ServiceCriticality } from '../services/services.contract.js';
import { LEVELS } from './incidents.activity.js';
import type { Calendar } from './incidents.calendar.js';
import type { Attention } from './incidents.attention.js';
import type { Occurrence } from './incidents.occurrence.js';
import { MEMBER_LEVELS } from './member-activity.js';
import type { MemberActivityCategory } from './member-activity.js';
import type { OperationalActivityCategory } from './incidents.activity.js';
import { TYPICAL_RESOLUTION_MINIMUM } from './incidents.schemas.js';
import type {
  ActiveStatusCounts,
  AffectedServiceResponse,
  ActivityIncidentResponse,
  MemberActivityResponse,
  OperationalActivityResponse,
  IncidentActivityResponse,
  IncidentActivityType,
  IncidentAttentionResponse,
  IncidentDetailResponse,
  IncidentListItemResponse,
  IncidentOccurrenceResponse,
  IncidentResponderStatus,
  IncidentResponse,
  IncidentSeverity,
  IncidentStatus,
  IncidentSummaryResponse,
  MemberResponseResponse,
  SeverityCounts,
  TypicalResolutionResponse,
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

/**
 * An incident as a list gives it: with its responders' statuses counted, and
 * its latest update's time — the one row the list selects of each.
 */
export const toIncidentListItemResponse = (
  incident: IncidentRow & {
    responders: readonly { status: IncidentResponderStatus }[];
    activity: readonly { createdAt: Date }[];
  },
): IncidentListItemResponse => ({
  ...toIncidentResponse(incident),
  response: {
    investigating: incident.responders.filter(
      ({ status }) => status === 'INVESTIGATING',
    ).length,
    completed: incident.responders.filter(
      ({ status }) => status === 'COMPLETED',
    ).length,
  },
  lastUpdateAt: incident.activity[0]?.createdAt.toISOString() ?? null,
});

/** One of a member's responses, with its incident as the lists give it. */
export const toMemberResponseResponse = (response: {
  status: IncidentResponderStatus;
  startedAt: Date;
  completedAt: Date | null;
  incident: IncidentRow;
}): MemberResponseResponse => ({
  incident: toIncidentResponse(response.incident),
  status: response.status,
  startedAt: response.startedAt.toISOString(),
  completedAt: response.completedAt?.toISOString() ?? null,
});

interface IncidentResponderRow {
  status: IncidentResponderStatus;
  startedAt: Date;
  completedAt: Date | null;
  membership: { id: string; user: { name: string } };
}

interface IncidentDetailRow extends IncidentRow {
  resolution: string | null;
  responders: IncidentResponderRow[];
}

/** An incident with its responders, identity only — never an email. */
export const toIncidentDetailResponse = (
  incident: IncidentDetailRow,
): IncidentDetailResponse => ({
  ...toIncidentResponse(incident),
  resolution: incident.resolution,
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

/** The identity a calendar names an incident by: never its prose. */
interface ActivityIncidentRow {
  id: string;
  number: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  service: { name: string; slug: string };
}

/** An incident a day touched: identity, where it stands, and how much. */
const toActivityIncidentResponse = ({
  incident,
  events,
}: {
  incident: ActivityIncidentRow;
  events: number;
}): ActivityIncidentResponse => ({
  id: incident.id,
  number: incident.number,
  title: incident.title,
  severity: incident.severity,
  status: incident.status,
  service: { name: incident.service.name, slug: incident.service.slug },
  events,
});

/**
 * A built calendar's days, shaped for the wire. The judgement is already
 * made — which entries counted, and how busy each day was — so this only
 * names the period and shapes each day's incidents. Both activity routes
 * emit the same day shape over their own categories, which is why this is
 * generic over them; what the categories *mean* is not shared.
 */
const toCalendarDays = <Category extends string>(
  calendar: Calendar<Category, ActivityIncidentRow>,
) =>
  calendar.days.map((day) => ({
    date: day.date,
    total: day.total,
    level: day.level,
    counts: { ...day.counts },
    incidents: day.incidents.map(toActivityIncidentResponse),
    moreIncidents: day.moreIncidents,
  }));

/** The organization's activity over a period (incidents.activity.ts). */
export const toOperationalActivityResponse = (
  calendar: Calendar<OperationalActivityCategory, ActivityIncidentRow>,
  period: { from: string; to: string },
): OperationalActivityResponse => ({
  from: period.from,
  to: period.to,
  days: toCalendarDays(calendar),
  total: calendar.total,
  activeDays: calendar.activeDays,
  thresholds: [...LEVELS],
});

/** A service as the occurrence reads it: identity, and its archival. */
interface OccurrenceServiceRow {
  id: string;
  name: string;
  slug: string;
  criticality: ServiceCriticality;
  archivedAt: Date | null;
}

/**
 * The organization's incident occurrence over a period
 * (incidents.occurrence.ts). Every field named, as everywhere here; the
 * instants become ISO strings.
 */
export const toIncidentOccurrenceResponse = (
  occurrence: Occurrence<OccurrenceServiceRow>,
): IncidentOccurrenceResponse => ({
  from: occurrence.from,
  to: occurrence.to,
  asOf: occurrence.asOf.toISOString(),
  trackedFrom: occurrence.trackedFrom,
  declared: occurrence.declared,
  incidentFreeDays: occurrence.incidentFreeDays,
  completeDays: occurrence.completeDays,
  days: occurrence.days.map((day) => ({
    date: day.date,
    declared: day.declared,
    complete: day.complete,
    tracked: day.tracked,
    rollingAverage: day.rollingAverage,
  })),
  previous: {
    from: occurrence.previous.from,
    to: occurrence.previous.to,
    declared: occurrence.previous.declared,
    comparable: occurrence.previous.comparable,
    minimumSample: occurrence.previous.minimumSample,
    changePercent: occurrence.previous.changePercent,
  },
  services: {
    top: occurrence.services.top.map((service) => ({
      id: service.id,
      name: service.name,
      slug: service.slug,
      criticality: service.criticality,
      archivedAt: service.archivedAt?.toISOString() ?? null,
      declared: service.declared,
      share: service.share,
    })),
    others: {
      services: occurrence.services.others.services,
      declared: occurrence.services.others.declared,
    },
  },
});

/**
 * One member's response activity over a period (member-activity.ts). Its own
 * thresholds: a person's bands, never the organization's.
 */
export const toMemberActivityResponse = (
  calendar: Calendar<MemberActivityCategory, ActivityIncidentRow>,
  period: { from: string; to: string },
): MemberActivityResponse => ({
  from: period.from,
  to: period.to,
  days: toCalendarDays(calendar),
  total: calendar.total,
  activeDays: calendar.activeDays,
  thresholds: [...MEMBER_LEVELS],
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

/** Active incidents at one status, as `groupBy` returns them. */
interface StatusCountRow {
  status: IncidentStatus;
  _count: { _all: number };
}

/**
 * One severity's resolutions in the typical-resolution window, as the raw
 * median query returns them. `median_ms` is Postgres's `percentile_cont`.
 */
export interface TypicalResolutionRow {
  severity: string;
  resolved: number;
  median_ms: number | null;
}

/**
 * The active incidents by status. Only the two active statuses are counts
 * here: a resolved incident is not active, so a row for one is not counted.
 */
const countByStatus = (rows: readonly StatusCountRow[]): ActiveStatusCounts => {
  const counts: ActiveStatusCounts = { DECLARED: 0, INVESTIGATING: 0 };

  for (const row of rows) {
    if (row.status === 'DECLARED' || row.status === 'INVESTIGATING') {
      counts[row.status] += row._count._all;
    }
  }

  return counts;
};

/**
 * Every severity's typical resolution time, from the median query's rows.
 * A severity with no row resolved nothing in the window; one with fewer
 * than the minimum has a count and no median. A row naming no known
 * severity is not one of these, and is ignored.
 */
const toTypicalResolution = (
  rows: readonly TypicalResolutionRow[],
  window: { from: string; to: string },
): TypicalResolutionResponse => {
  const bySeverity = Object.fromEntries(
    SEVERITIES.map((severity) => [severity, { resolved: 0, medianMs: null }]),
  ) as TypicalResolutionResponse['bySeverity'];

  for (const row of rows) {
    if (!SEVERITIES.includes(row.severity as IncidentSeverity)) continue;

    const resolved = Number(row.resolved);

    bySeverity[row.severity as IncidentSeverity] = {
      resolved,
      medianMs:
        resolved >= TYPICAL_RESOLUTION_MINIMUM && row.median_ms !== null
          ? Math.round(Number(row.median_ms))
          : null,
    };
  }

  return {
    from: window.from,
    to: window.to,
    minimumSample: TYPICAL_RESOLUTION_MINIMUM,
    bySeverity,
  };
};

/** One response still under way: who is on it, and whose incident it is. */
interface ActiveResponderRow {
  membershipId: string;
  incidentId: string;
  incident: { teamId: string };
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
 * How many people are investigating, and across how many teams.
 *
 * One row per response, so someone investigating three incidents is three
 * rows and one person — both figures are counts of distinct things, never
 * of rows.
 */
const countResponders = (
  rows: readonly ActiveResponderRow[],
): IncidentSummaryResponse['current']['responders'] => ({
  active: new Set(rows.map((row) => row.membershipId)).size,
  teams: new Set(rows.map((row) => row.incident.teamId)).size,
});

/**
 * The summary, from the rows its queries return. `active` is grouped by
 * service and severity, which gives both the organization's active counts
 * and each affected service's. Services are ordered by their most severe
 * active incident, then by criticality, then by name. `responders` is one
 * row per response still under way, counted into people and teams here
 * rather than in SQL, so the distinctness is tested with the rest of the
 * shaping.
 */
export const toIncidentSummaryResponse = ({
  active,
  services,
  responders,
  statuses,
  typical,
  declared,
  resolved,
  stillOpen,
  period,
  history,
}: {
  active: readonly ActiveCountRow[];
  services: readonly AffectedServiceRow[];
  responders: readonly ActiveResponderRow[];
  statuses: readonly StatusCountRow[];
  typical: {
    rows: readonly TypicalResolutionRow[];
    window: { from: string; to: string };
  };
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
      responders: countResponders(responders),
      activeByStatus: countByStatus(statuses),
      // Investigating, less those someone is still investigating.
      readyToResolve: Math.max(
        0,
        countByStatus(statuses).INVESTIGATING -
          new Set(responders.map((row) => row.incidentId)).size,
      ),
      typicalResolution: toTypicalResolution(typical.rows, typical.window),
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
