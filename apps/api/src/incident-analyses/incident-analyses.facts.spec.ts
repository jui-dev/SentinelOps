import type { IncidentActivityType } from '../incidents/incidents.contract.js';
import { deriveIncidentFacts } from './incident-analyses.facts.js';
import type { FactsEntry } from './incident-analyses.facts.js';

const DECLARED_AT = new Date('2026-09-10T09:00:00.000Z');
const minutes = (n: number) => new Date(DECLARED_AT.getTime() + n * 60_000);

const ADMIN = { id: 'u-admin', name: 'Avery Admin' };
const ADA = { id: 'u-ada', name: 'Ada Lovelace' };
const GRACE = { id: 'u-grace', name: 'Grace Hopper' };

let sequence = 0;

/** An entry with a fresh id that sorts after every earlier one. */
const entry = (
  type: IncidentActivityType,
  at: Date,
  actor = ADMIN,
  values: { fromValue?: string; toValue?: string } = {},
): FactsEntry => ({
  id: `0199-${String(++sequence).padStart(4, '0')}`,
  type,
  fromValue: values.fromValue ?? null,
  toValue: values.toValue ?? null,
  createdAt: at,
  actor,
});

const resolvedAt = minutes(120);

const incident = (severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4' = 'SEV3') => ({
  createdAt: DECLARED_AT,
  resolvedAt,
  severity,
});

const declared = (severity = 'SEV3') =>
  entry('DECLARED', DECLARED_AT, ADMIN, { toValue: severity });

const resolution = (at = resolvedAt) =>
  entry('STATUS_CHANGED', at, ADMIN, {
    fromValue: 'INVESTIGATING',
    toValue: 'RESOLVED',
  });

/** A first start, and the move to INVESTIGATING a millisecond after it. */
const firstStart = (at: Date, actor = ADA) => [
  entry('RESPONSE_STARTED', at, actor),
  entry('STATUS_CHANGED', new Date(at.getTime() + 1), actor, {
    fromValue: 'DECLARED',
    toValue: 'INVESTIGATING',
  }),
];

beforeEach(() => {
  sequence = 0;
});

describe('deriveIncidentFacts', () => {
  describe('facts', () => {
    it('should read the declaration and resolution from the incident, and count what the timeline recorded', () => {
      const { facts } = deriveIncidentFacts(incident(), [
        declared(),
        ...firstStart(minutes(12)),
        entry('UPDATE', minutes(20), ADA),
        entry('RESPONSE_STARTED', minutes(25), GRACE),
        entry('UPDATE', minutes(40), GRACE),
        // The Admin's update counts too: an update is an update.
        entry('UPDATE', minutes(45), ADMIN),
        entry('RESPONSE_COMPLETED', minutes(90), GRACE),
        entry('RESPONSE_COMPLETED', minutes(100), ADA),
        resolution(),
      ]);

      expect(facts).toEqual({
        declaredAt: DECLARED_AT,
        resolvedAt,
        firstResponseAt: minutes(12),
        responderCount: 2,
        updateCount: 3,
        severity: { declared: 'SEV3', highest: 'SEV3', final: 'SEV3' },
        reassignmentCount: 0,
      });
    });

    it('should take the declared severity from before the first change, and the highest across every change', () => {
      // Declared SEV3, escalated to SEV1, eased to SEV2.
      const { facts } = deriveIncidentFacts(incident('SEV2'), [
        declared('SEV3'),
        ...firstStart(minutes(5)),
        entry('SEVERITY_CHANGED', minutes(15), ADMIN, {
          fromValue: 'SEV3',
          toValue: 'SEV1',
        }),
        entry('SEVERITY_CHANGED', minutes(60), ADMIN, {
          fromValue: 'SEV1',
          toValue: 'SEV2',
        }),
        resolution(),
      ]);

      expect(facts.severity).toEqual({
        declared: 'SEV3',
        highest: 'SEV1',
        final: 'SEV2',
      });
    });

    it('should report one severity throughout when it never changed', () => {
      const { facts } = deriveIncidentFacts(incident('SEV4'), [
        declared('SEV4'),
        resolution(),
      ]);

      expect(facts.severity).toEqual({
        declared: 'SEV4',
        highest: 'SEV4',
        final: 'SEV4',
      });
    });

    it('should count every reassignment of the responsible team', () => {
      const { facts } = deriveIncidentFacts(incident(), [
        declared(),
        entry('TEAM_CHANGED', minutes(3), ADMIN, {
          fromValue: 'Payments',
          toValue: 'Platform',
        }),
        entry('TEAM_CHANGED', minutes(8), ADMIN, {
          fromValue: 'Platform',
          toValue: 'Payments',
        }),
        resolution(),
      ]);

      expect(facts.reassignmentCount).toBe(2);
    });

    // Incidents resolved before responses were recorded — the team-based
    // response migration removed the old assignment rows, and no response
    // entry was ever written for them — have no response on their timeline.
    it('should report no first response and no responders when none was recorded', () => {
      const { facts, keyMoments } = deriveIncidentFacts(incident(), [
        declared(),
        entry('UPDATE', minutes(30), ADMIN),
        resolution(),
      ]);

      expect(facts.firstResponseAt).toBeNull();
      expect(facts.responderCount).toBe(0);
      expect(keyMoments.map(({ kind }) => kind)).toEqual([
        'DECLARED',
        'RESOLVED',
      ]);
    });
  });

  describe('key moments', () => {
    it('should select the moments that shaped the incident, in timeline order', () => {
      const { keyMoments } = deriveIncidentFacts(incident('SEV1'), [
        declared('SEV3'),
        ...firstStart(minutes(12)),
        entry('UPDATE', minutes(14), ADA),
        entry('SEVERITY_CHANGED', minutes(18), ADMIN, {
          fromValue: 'SEV3',
          toValue: 'SEV1',
        }),
        entry('TEAM_CHANGED', minutes(22), ADMIN, {
          fromValue: 'Payments',
          toValue: 'Platform',
        }),
        entry('RESPONSE_STARTED', minutes(30), GRACE),
        entry('RESPONSE_COMPLETED', minutes(80), ADA),
        entry('RESPONSE_COMPLETED', minutes(95), GRACE),
        resolution(),
      ]);

      expect(
        keyMoments.map(({ kind, at, actor, fromValue, toValue }) => ({
          kind,
          at,
          actor: actor.name,
          fromValue,
          toValue,
        })),
      ).toEqual([
        {
          kind: 'DECLARED',
          at: DECLARED_AT,
          actor: 'Avery Admin',
          fromValue: null,
          toValue: 'SEV3',
        },
        {
          kind: 'FIRST_RESPONSE',
          at: minutes(12),
          actor: 'Ada Lovelace',
          fromValue: null,
          toValue: null,
        },
        {
          kind: 'SEVERITY_CHANGED',
          at: minutes(18),
          actor: 'Avery Admin',
          fromValue: 'SEV3',
          toValue: 'SEV1',
        },
        {
          kind: 'TEAM_CHANGED',
          at: minutes(22),
          actor: 'Avery Admin',
          fromValue: 'Payments',
          toValue: 'Platform',
        },
        {
          kind: 'LAST_RESPONSE_COMPLETED',
          at: minutes(95),
          actor: 'Grace Hopper',
          fromValue: null,
          toValue: null,
        },
        {
          kind: 'RESOLVED',
          at: resolvedAt,
          actor: 'Avery Admin',
          fromValue: 'INVESTIGATING',
          toValue: 'RESOLVED',
        },
      ]);
    });

    it('should keep the timeline entry each moment came from', () => {
      const entries = [declared(), resolution()];

      const { keyMoments } = deriveIncidentFacts(incident(), entries);

      expect(keyMoments.map(({ activityId }) => activityId)).toEqual(
        entries.map(({ id }) => id),
      );
    });

    it('should give one responder both the first response and the last completion', () => {
      const { keyMoments } = deriveIncidentFacts(incident(), [
        declared(),
        ...firstStart(minutes(10)),
        entry('RESPONSE_COMPLETED', minutes(70), ADA),
        resolution(),
      ]);

      expect(keyMoments.map(({ kind }) => kind)).toEqual([
        'DECLARED',
        'FIRST_RESPONSE',
        'LAST_RESPONSE_COMPLETED',
        'RESOLVED',
      ]);
    });

    // A timeline entry that says an incident moved to IDENTIFIED or
    // MONITORING stays true of what happened then; it is simply not one of
    // the moments.
    it('should leave out updates, the move to INVESTIGATING, and retired status changes', () => {
      const { keyMoments } = deriveIncidentFacts(incident(), [
        declared(),
        ...firstStart(minutes(10)),
        entry('UPDATE', minutes(15), ADA),
        entry('STATUS_CHANGED', minutes(20), ADMIN, {
          fromValue: 'INVESTIGATING',
          toValue: 'MONITORING',
        }),
        entry('RESPONSE_COMPLETED', minutes(70), ADA),
        resolution(),
      ]);

      expect(keyMoments.map(({ kind }) => kind)).toEqual([
        'DECLARED',
        'FIRST_RESPONSE',
        'LAST_RESPONSE_COMPLETED',
        'RESOLVED',
      ]);
    });
  });

  describe('order', () => {
    it('should order by time, whatever order the entries arrive in', () => {
      const entries = [
        declared(),
        ...firstStart(minutes(10)),
        entry('RESPONSE_COMPLETED', minutes(70), ADA),
        resolution(),
      ];

      const forward = deriveIncidentFacts(incident(), entries);
      const reversed = deriveIncidentFacts(incident(), [...entries].reverse());

      expect(reversed).toEqual(forward);
    });

    // The entries of one change share a time — a severity change and the
    // resolution in one request — and the id breaks the tie, as the
    // timeline's own order does.
    it('should break a tie in time by id', () => {
      const severity = entry('SEVERITY_CHANGED', resolvedAt, ADMIN, {
        fromValue: 'SEV3',
        toValue: 'SEV2',
      });
      const resolved = resolution(resolvedAt);

      const { keyMoments } = deriveIncidentFacts(incident('SEV2'), [
        resolved,
        severity,
        declared(),
      ]);

      expect(keyMoments.map(({ kind }) => kind)).toEqual([
        'DECLARED',
        'SEVERITY_CHANGED',
        'RESOLVED',
      ]);
    });

    it('should choose the first start and the last completion by timeline order, not arrival', () => {
      const early = entry('RESPONSE_STARTED', minutes(5), GRACE);
      const late = entry('RESPONSE_STARTED', minutes(9), ADA);
      const firstDone = entry('RESPONSE_COMPLETED', minutes(50), ADA);
      const lastDone = entry('RESPONSE_COMPLETED', minutes(60), GRACE);

      const { facts, keyMoments } = deriveIncidentFacts(incident(), [
        lastDone,
        late,
        firstDone,
        early,
      ]);

      expect(facts.firstResponseAt).toEqual(minutes(5));
      expect(
        keyMoments.map(({ kind, activityId }) => [kind, activityId]),
      ).toEqual([
        ['FIRST_RESPONSE', early.id],
        ['LAST_RESPONSE_COMPLETED', lastDone.id],
      ]);
    });

    it('should not reorder the entries it was given', () => {
      const entries = [resolution(), declared()];
      const before = [...entries];

      deriveIncidentFacts(incident(), entries);

      expect(entries).toEqual(before);
    });
  });
});
