/**
 * TEMPORARY — turns the story in demo-story.ts into incidents, responses, and
 * timelines. Pure and deterministic: the same anchor always gives the same
 * history, and weeks are counted back from the anchor, so it always covers
 * the 26 weeks before it. Days keep their weekday: an anchor a week later
 * gives the same history a week later.
 *
 * Each incident is built by replaying what the application itself does, in
 * order (see IncidentsService): the Admin declares; the first responder's
 * start moves it to INVESTIGATING a millisecond later; responders post while
 * investigating and complete their own part; the Admin resolves once nobody
 * is still investigating, with a note that is also the resolution entry's
 * message. checkDemoHistory verifies the result independently.
 */
import type { DevTeam } from '../dev-account.js';
import {
  ACTIVE,
  ADMIN,
  ADMIN_UPDATES,
  ARCS,
  AWAY,
  FALLBACK_UPDATES,
  PICKUP,
  SCENARIOS,
  SERVICE_TEAM,
  TEAM_MEMBERS,
  VOICE,
  WEEKLY_LOAD,
} from './demo-story.js';
import type {
  ActiveIncident,
  DemoService,
  Scenario,
  Severity,
} from './demo-story.js';

export type DemoActivityType =
  | 'DECLARED'
  | 'UPDATE'
  | 'SEVERITY_CHANGED'
  | 'STATUS_CHANGED'
  | 'RESPONSE_STARTED'
  | 'RESPONSE_COMPLETED';

/** One timeline entry. `actor` is a persona's email. */
export interface DemoActivity {
  type: DemoActivityType;
  actor: string;
  at: Date;
  message: string | null;
  fromValue: string | null;
  toValue: string | null;
}

export interface DemoResponse {
  responder: string;
  startedAt: Date;
  completedAt: Date | null;
}

export interface DemoIncident {
  number: number;
  title: string;
  summary: string;
  service: DemoService;
  team: DevTeam;
  severity: Severity;
  status: 'DECLARED' | 'INVESTIGATING' | 'RESOLVED';
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
  responders: DemoResponse[];
  /** Oldest first. */
  activity: DemoActivity[];
}

export const HISTORY_WEEKS = WEEKLY_LOAD.length;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const SEED = 'acmepay-demo-history-v1';

/** mulberry32, seeded by an FNV-1a hash of the parts. */
const rngFor = (...parts: (string | number)[]): (() => number) => {
  let seed = 0x811c9dc5;

  for (const char of [SEED, ...parts].join('|')) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 0x01000193);
  }

  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Rng = () => number;

const between = (rng: Rng, min: number, max: number) =>
  min + rng() * (max - min);

const intBetween = (rng: Rng, min: number, max: number) =>
  Math.floor(between(rng, min, max + 1));

const shuffled = <T>(items: readonly T[], rng: Rng): T[] => {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
};

/** Minutes, per severity: first response, further starts, response span. */
const TIMING: Record<
  Severity,
  {
    firstResponse: [number, number];
    laterStart: [number, number];
    span: [number, number];
    updates: [number, number];
  }
> = {
  SEV1: {
    firstResponse: [2, 8],
    laterStart: [3, 25],
    span: [60, 180],
    updates: [3, 5],
  },
  SEV2: {
    firstResponse: [4, 15],
    laterStart: [5, 30],
    span: [60, 300],
    updates: [2, 4],
  },
  SEV3: {
    firstResponse: [10, 45],
    laterStart: [10, 90],
    span: [120, 1440],
    updates: [1, 3],
  },
  SEV4: {
    firstResponse: [30, 240],
    laterStart: [10, 90],
    span: [240, 4320],
    updates: [0, 2],
  },
};

/** How many of the available team members take part. */
const responderCount = (
  severity: Severity,
  available: number,
  rng: Rng,
): number => {
  const chanceOfSecond = { SEV1: 1, SEV2: 0.85, SEV3: 0.35, SEV4: 0.1 };

  return Math.min(available, rng() < chanceOfSecond[severity] ? 2 : 1);
};

/** The available members in the order they pick an incident up. */
const pickupOrder = (available: readonly string[], rng: Rng): string[] => {
  const weight = (persona: string) => PICKUP[persona] ?? 1;
  let target = rng() * available.reduce((sum, p) => sum + weight(p), 0);
  const first =
    available.find((persona) => (target -= weight(persona)) < 0) ??
    available[0];

  return [first, ...available.filter((persona) => persona !== first)];
};

const isAway = (persona: string, week: number): boolean => {
  const away = AWAY[persona];

  return away !== undefined && week >= away[0] && week <= away[1];
};

const LESS_SEVERE: Partial<Record<Severity, Severity>> = {
  SEV2: 'SEV3',
  SEV3: 'SEV4',
};
const MORE_SEVERE: Partial<Record<Severity, Severity>> = { SEV3: 'SEV2' };

interface Planned {
  key: string;
  week: number;
  declaredAt: Date;
  service: DemoService;
  severity: Severity;
  declaredAs: Severity;
  scenario: Scenario;
  /** The incident it recurs, when this is a scenario's second use. */
  recurs?: string;
}

const activity = (
  type: DemoActivityType,
  actor: string,
  at: number,
  extra: Partial<Pick<DemoActivity, 'message' | 'fromValue' | 'toValue'>> = {},
): DemoActivity => ({
  type,
  actor,
  at: new Date(at),
  message: extra.message ?? null,
  fromValue: extra.fromValue ?? null,
  toValue: extra.toValue ?? null,
});

const byTime = (a: DemoActivity, b: DemoActivity) =>
  a.at.getTime() - b.at.getTime();

/**
 * Update messages in time order: the scenario's own lines first, as an
 * investigation reads, then general ones. The Admin's come from their own.
 */
const assignMessages = (
  events: DemoActivity[],
  scenarioUpdates: readonly string[],
) => {
  let responder = 0;
  let admin = 0;

  for (const event of [...events].sort(byTime)) {
    if (event.type !== 'UPDATE') {
      continue;
    }

    event.message =
      event.actor === ADMIN
        ? ADMIN_UPDATES[admin++ % ADMIN_UPDATES.length]
        : (scenarioUpdates[responder] ??
          FALLBACK_UPDATES[
            (responder - scenarioUpdates.length) % FALLBACK_UPDATES.length
          ]);

    if (event.actor !== ADMIN) {
      responder++;
    }
  }
};

/** One resolved incident, replayed from its declaration. */
const replayResolved = (plan: Planned): Omit<DemoIncident, 'number'> => {
  const rng = rngFor('replay', plan.key);
  const timing = TIMING[plan.severity];
  const team = SERVICE_TEAM[plan.service];
  const available = TEAM_MEMBERS[team].filter(
    (persona) => !isAway(persona, plan.week),
  );

  if (available.length === 0) {
    throw new Error(`Nobody on ${team} could respond to ${plan.key}`);
  }

  const chosen = pickupOrder(available, rng).slice(
    0,
    responderCount(plan.severity, available.length, rng),
  );

  const declared = plan.declaredAt.getTime();
  const first =
    declared + between(rng, ...timing.firstResponse) * MINUTE + rng() * 1000;
  const span = between(rng, ...timing.span) * MINUTE;
  const lastCompletion = first + span;

  const events: DemoActivity[] = [
    activity('DECLARED', ADMIN, declared, { toValue: plan.declaredAs }),
  ];
  const responders: DemoResponse[] = [];
  // One responder finishes last; the others somewhere in the second half.
  const finisher = intBetween(rng, 0, chosen.length - 1);

  chosen.forEach((persona, index) => {
    const start =
      index === 0 ? first : first + between(rng, ...timing.laterStart) * MINUTE;
    const complete =
      index === finisher
        ? lastCompletion
        : between(
            rng,
            Math.max(start + 10 * MINUTE, first + span / 2),
            lastCompletion - MINUTE,
          );

    responders.push({
      responder: persona,
      startedAt: new Date(start),
      completedAt: new Date(complete),
    });
    events.push(activity('RESPONSE_STARTED', persona, start));

    // The first start moves the incident, a millisecond later, and the
    // change is the responder's doing, as startResponse records it.
    if (index === 0) {
      events.push(
        activity('STATUS_CHANGED', persona, start + 1, {
          fromValue: 'DECLARED',
          toValue: 'INVESTIGATING',
        }),
      );
    }

    const updates = Math.round(
      intBetween(rng, ...timing.updates) * (VOICE[persona] ?? 1),
    );

    for (let i = 0; i < updates; i++) {
      events.push(
        activity(
          'UPDATE',
          persona,
          between(rng, start + 2 * MINUTE, complete - 2 * MINUTE),
        ),
      );
    }

    events.push(activity('RESPONSE_COMPLETED', persona, complete));
  });

  const adminUpdates =
    plan.severity === 'SEV1'
      ? 2
      : plan.severity === 'SEV2' && rng() < 0.4
        ? 1
        : 0;

  for (let i = 0; i < adminUpdates; i++) {
    events.push(
      activity(
        'UPDATE',
        ADMIN,
        between(rng, first + 5 * MINUTE, lastCompletion - 5 * MINUTE),
      ),
    );
  }

  if (plan.declaredAs !== plan.severity) {
    events.push(
      activity(
        'SEVERITY_CHANGED',
        ADMIN,
        between(rng, first + 5 * MINUTE, first + span / 2),
        { fromValue: plan.declaredAs, toValue: plan.severity },
      ),
    );
  }

  const resolvedAt = lastCompletion + between(rng, 5, 60) * MINUTE;

  events.push(
    activity('STATUS_CHANGED', ADMIN, resolvedAt, {
      fromValue: 'INVESTIGATING',
      toValue: 'RESOLVED',
      message: plan.scenario.resolution,
    }),
  );

  assignMessages(events, plan.scenario.updates);
  events.sort(byTime);

  return {
    title: plan.scenario.title,
    summary: plan.scenario.summary,
    service: plan.service,
    team,
    severity: plan.severity,
    status: 'RESOLVED',
    createdAt: new Date(declared),
    updatedAt: new Date(resolvedAt),
    resolvedAt: new Date(resolvedAt),
    resolution: plan.scenario.resolution,
    responders: responders.sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    ),
    activity: events,
  };
};

/** One of the incidents still open at the anchor, exactly as written. */
const replayActive = (
  incident: ActiveIncident,
  anchor: number,
): Omit<DemoIncident, 'number'> => {
  const declared = anchor - incident.declared * MINUTE;
  const at = (minutes: number) => declared + minutes * MINUTE;
  const events: DemoActivity[] = [
    activity('DECLARED', ADMIN, declared, { toValue: incident.severity }),
  ];
  const responses = [...incident.responses].sort((a, b) => a.start - b.start);

  responses.forEach((response, index) => {
    events.push(
      activity('RESPONSE_STARTED', response.responder, at(response.start)),
    );

    if (index === 0) {
      events.push(
        activity('STATUS_CHANGED', response.responder, at(response.start) + 1, {
          fromValue: 'DECLARED',
          toValue: 'INVESTIGATING',
        }),
      );
    }

    for (const update of response.updates) {
      events.push(activity('UPDATE', response.responder, at(update)));
    }

    if (response.complete !== undefined) {
      events.push(
        activity(
          'RESPONSE_COMPLETED',
          response.responder,
          at(response.complete),
        ),
      );
    }
  });

  for (const update of incident.adminUpdates ?? []) {
    events.push(activity('UPDATE', ADMIN, at(update)));
  }

  assignMessages(events, incident.updates);
  events.sort(byTime);

  return {
    title: incident.title,
    summary: incident.summary,
    service: incident.service,
    team: SERVICE_TEAM[incident.service],
    severity: incident.severity,
    status: responses.length > 0 ? 'INVESTIGATING' : 'DECLARED',
    createdAt: new Date(declared),
    updatedAt: events.at(-1)!.at,
    resolvedAt: null,
    resolution: null,
    responders: responses.map((response) => ({
      responder: response.responder,
      startedAt: new Date(at(response.start)),
      completedAt:
        response.complete === undefined
          ? null
          : new Date(at(response.complete)),
    })),
    activity: events,
  };
};

/** Weekdays, Monday first, weigh the same; a weekend day a quarter as much. */
const WEEKDAY_WEIGHTS = [1, 1, 1, 1, 1, 0.25, 0.25];

/** Monday 0 … Sunday 6. */
const weekdayOf = (time: number): number =>
  (new Date(time).getUTCDay() + 6) % 7;

/** A day of the week starting on `firstWeekday`, as an offset into it. */
const pickDay = (rng: Rng, firstWeekday: number): number => {
  const weight = (offset: number) =>
    WEEKDAY_WEIGHTS[(firstWeekday + offset) % 7];
  let target = rng() * WEEKDAY_WEIGHTS.reduce((sum, w) => sum + w, 0);

  for (let offset = 0; offset < 7; offset++) {
    target -= weight(offset);

    if (target < 0) {
      return offset;
    }
  }

  return 0;
};

/** Everyday and pinned incidents, before the anchor's cut-off is applied. */
const plan = (historyStart: number): Planned[] => {
  const weekStart = (week: number) => historyStart + (week - 1) * WEEK;
  const firstWeekday = weekdayOf(historyStart);
  const services: DemoService[] = [
    'Payment API',
    'Authentication',
    'Fraud Detection',
  ];
  // Each service's scenarios in a fixed shuffled order, used once, then once
  // more as recurrences.
  const pools = new Map(
    services.map((service) => [
      service,
      shuffled(SCENARIOS[service], rngFor('pool', service)),
    ]),
  );
  const used = new Map<Scenario, string>();
  const planned: Planned[] = [];

  WEEKLY_LOAD.forEach((load, index) => {
    const week = index + 1;

    services.forEach((service, column) => {
      for (let slot = 0; slot < load[column]; slot++) {
        const key = `W${week}-${service}-${slot}`;
        const rng = rngFor('plan', key);
        const pool = pools.get(service)!;
        const scenario = pool.shift();

        if (!scenario) {
          throw new Error(`${service} has run out of scenarios`);
        }

        // A scenario's first use goes back in the pool once, for a recurrence.
        if (!used.has(scenario)) {
          used.set(scenario, key);
          pool.push(scenario);
        }

        const severity =
          scenario.severities.length > 1 && rng() >= 0.6
            ? scenario.severities[1]
            : scenario.severities[0];
        const changed = rng() < 0.12;
        const declaredAs = changed
          ? ((rng() < 0.67 ? LESS_SEVERE[severity] : MORE_SEVERE[severity]) ??
            severity)
          : severity;
        const day = pickDay(rng, firstWeekday);
        const minuteOfDay = intBetween(rng, 8 * 60, 19 * 60 - 1);

        planned.push({
          key,
          week,
          declaredAt: new Date(
            weekStart(week) +
              day * DAY +
              minuteOfDay * MINUTE +
              Math.floor(rng() * 60_000),
          ),
          service,
          severity,
          declaredAs,
          scenario,
          recurs: used.get(scenario) === key ? undefined : used.get(scenario),
        });
      }
    });
  });

  ARCS.forEach((arc, index) => {
    const [hours, minutes] = arc.time.split(':').map(Number);

    planned.push({
      key: `arc-${index}`,
      week: arc.week,
      declaredAt: new Date(
        weekStart(arc.week) +
          ((arc.day - firstWeekday + 7) % 7) * DAY +
          hours * HOUR +
          minutes * MINUTE +
          intBetween(rngFor('arc', index), 0, 59) * 1000,
      ),
      service: arc.service,
      severity: arc.severity,
      declaredAs: arc.declaredAs ?? arc.severity,
      scenario: arc,
    });
  });

  return planned;
};

/** How long before the anchor every resolved incident must be finished. */
const SETTLED = HOUR;

/**
 * The demo history for an anchor: 00:00 UTC of the day it ends. Nothing in it
 * happens at or after the anchor. Numbered 1..N in declaration order.
 */
export const buildDemoHistory = (anchor: Date): DemoIncident[] => {
  const end = anchor.getTime();

  if (end % DAY !== 0) {
    throw new Error('The anchor must be 00:00 UTC');
  }

  const historyStart = end - HISTORY_WEEKS * WEEK;
  const plans = plan(historyStart);
  const entries: { key?: string; incident: Omit<DemoIncident, 'number'> }[] =
    [];

  for (const planned of plans) {
    const incident = replayResolved(planned);

    // Whatever would still be running at the anchor is left out: the
    // present is ACTIVE's.
    if (incident.resolvedAt!.getTime() <= end - SETTLED) {
      entries.push({ key: planned.key, incident });
    }
  }

  for (const incident of ACTIVE) {
    entries.push({ incident: replayActive(incident, end) });
  }

  entries.sort(
    (a, b) => a.incident.createdAt.getTime() - b.incident.createdAt.getTime(),
  );

  const incidents = entries.map(({ incident }, index) => ({
    ...incident,
    number: index + 1,
  }));
  const numbers = new Map(
    entries.map(({ key }, index) => [key, index + 1] as const),
  );

  // A recurrence names the incident it repeats, once both are numbered.
  for (const planned of plans) {
    const number = numbers.get(planned.key);
    const original = planned.recurs && numbers.get(planned.recurs);

    if (number !== undefined && original) {
      const incident = incidents[number - 1];
      const note = `Same failure mode as INC-${original}. ${planned.scenario.resolution}`;

      incident.resolution = note;
      incident.activity.at(-1)!.message = note;
    }
  }

  return incidents;
};
