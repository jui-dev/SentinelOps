/**
 * TEMPORARY — checks a demo history against the rules the application itself
 * enforces, independently of how buildDemoHistory produced it. Returns every
 * violation found, as text; an empty list means the history could have been
 * made through the API, in real time.
 *
 * DemoHistoryService refuses to write a history with any violation.
 */
import type { DemoIncident } from './build-demo-history.js';
import { ADMIN, MANAGER, REPORTER, TEAM_MEMBERS } from './demo-story.js';

/** Who decides on incidents: the Incident Manager, or the Admin in her place. */
const DECIDERS: ReadonlySet<string> = new Set([ADMIN, MANAGER]);

/** The request schemas' limits (incidents.schemas.ts). */
const TITLE_MAX = 200;
const TEXT_MAX = 2000;

export const checkDemoHistory = (
  incidents: readonly DemoIncident[],
  anchor: Date,
): string[] => {
  const problems: string[] = [];

  incidents.forEach((incident, index) => {
    const at = `INC-${incident.number}`;
    const fail = (problem: string) => problems.push(`${at}: ${problem}`);
    const events = incident.activity;
    const time = (date: Date) => date.getTime();

    if (incident.number !== index + 1) {
      fail('numbers are not 1..N in order');
    }

    if (
      index > 0 &&
      time(incidents[index - 1].createdAt) >= time(incident.createdAt)
    ) {
      fail('declared no later than the incident before it');
    }

    if (incident.title.length > TITLE_MAX) {
      fail('title too long');
    }

    for (const text of [
      incident.summary,
      incident.resolution,
      ...events.map((event) => event.message),
    ]) {
      if (text !== null && (text.trim() === '' || text.length > TEXT_MAX)) {
        fail('text blank or too long');
      }
    }

    // The timeline: strictly ordered, nothing at or after the anchor.
    events.forEach((event, i) => {
      if (i > 0 && time(events[i - 1].at) >= time(event.at)) {
        fail(`${event.type} is not strictly after the entry before it`);
      }
    });

    if (events.some((event) => time(event.at) >= time(anchor))) {
      fail('something happens at or after the anchor');
    }

    // Declared by whoever decides or by the Reporter, first, at the
    // incident's creation, by the person it names as its declarer.
    const [declared] = events;

    if (
      declared?.type !== 'DECLARED' ||
      !(DECIDERS.has(declared.actor) || declared.actor === REPORTER) ||
      declared.actor !== incident.declaredBy ||
      time(declared.at) !== time(incident.createdAt) ||
      events.filter((event) => event.type === 'DECLARED').length !== 1
    ) {
      fail('not declared exactly once, first, by someone who may declare');
    }

    // A Reporter's suggested severity: confirmed once, by whoever decides,
    // before anyone starts — or still waiting, with nobody chosen to respond.
    const confirmations = events.filter(
      (event) => event.type === 'SEVERITY_CONFIRMED',
    );
    const firstStarted = events.find(
      (event) => event.type === 'RESPONSE_STARTED',
    );

    if (incident.declaredBy !== REPORTER) {
      if (confirmations.length > 0 || !incident.severityConfirmed) {
        fail('a severity to confirm that nobody suggested');
      }
    } else if (incident.severityConfirmed) {
      const [confirmed] = confirmations;

      if (
        confirmations.length !== 1 ||
        !DECIDERS.has(confirmed.actor) ||
        confirmed.fromValue !== declared?.toValue ||
        (firstStarted !== undefined &&
          time(confirmed.at) >= time(firstStarted.at))
      ) {
        fail(
          'the suggested severity is not confirmed once, before anyone starts',
        );
      }
    } else if (
      confirmations.length > 0 ||
      incident.responseAccess !== 'PENDING' ||
      incident.responders.length > 0
    ) {
      fail('a suggestion waiting for a decision that was already made');
    }

    if (
      incident.responseAccess === 'PENDING' &&
      incident.responders.length > 0
    ) {
      fail('responding before anyone decided who may');
    }

    if (time(incident.updatedAt) !== time(events.at(-1)!.at)) {
      fail('updatedAt is not its last change');
    }

    // Severity: declared at one, changed only by whoever decides, ending at
    // the incident's own.
    let severity = declared?.toValue;

    for (const event of events) {
      if (
        event.type === 'SEVERITY_CHANGED' ||
        event.type === 'SEVERITY_CONFIRMED'
      ) {
        if (!DECIDERS.has(event.actor) || event.fromValue !== severity) {
          fail('a severity change is not a decider changing the current one');
        }

        severity = event.toValue;
      }
    }

    if (severity !== incident.severity) {
      fail('the severity does not match its timeline');
    }

    // Responders: the responsible team's members, each once, with their own
    // start and completion on the timeline.
    const members = TEAM_MEMBERS[incident.team];
    const seen = new Set<string>();

    for (const response of incident.responders) {
      const who = response.responder;
      const own = events.filter((event) => event.actor === who);
      const started = own.filter((event) => event.type === 'RESPONSE_STARTED');
      const completed = own.filter(
        (event) => event.type === 'RESPONSE_COMPLETED',
      );

      if (!members.includes(who) || seen.has(who)) {
        fail(`${who} is not a distinct member of ${incident.team}`);
      }

      seen.add(who);

      if (
        started.length !== 1 ||
        time(started[0].at) !== time(response.startedAt)
      ) {
        fail(`${who}'s start is not on the timeline`);
      }

      if (
        response.completedAt === null
          ? completed.length !== 0
          : completed.length !== 1 ||
            time(completed[0].at) !== time(response.completedAt)
      ) {
        fail(`${who}'s completion does not match the timeline`);
      }

      const until = response.completedAt ?? anchor;

      for (const update of own.filter((event) => event.type === 'UPDATE')) {
        if (
          time(update.at) <= time(response.startedAt) ||
          time(update.at) >= time(until)
        ) {
          fail(`${who} posts outside their own response`);
        }
      }
    }

    // Nobody else starts, completes, or posts, but whoever decides may post.
    for (const event of events) {
      const responding = seen.has(event.actor);

      if (
        (event.type === 'RESPONSE_STARTED' ||
          event.type === 'RESPONSE_COMPLETED' ||
          event.type === 'UPDATE') &&
        !responding &&
        !(event.type === 'UPDATE' && DECIDERS.has(event.actor))
      ) {
        fail(`${event.type} by ${event.actor}, who is not responding`);
      }
    }

    // Status: DECLARED → INVESTIGATING on the first start, a millisecond
    // later, by that responder → RESOLVED by whoever decides, last.
    const statusChanges = events.filter(
      (event) => event.type === 'STATUS_CHANGED',
    );
    const firstStart = events.find(
      (event) => event.type === 'RESPONSE_STARTED',
    );
    const investigating = statusChanges.filter(
      (event) => event.toValue === 'INVESTIGATING',
    );

    if (firstStart) {
      if (
        investigating.length !== 1 ||
        investigating[0].fromValue !== 'DECLARED' ||
        investigating[0].actor !== firstStart.actor ||
        time(investigating[0].at) !== time(firstStart.at) + 1
      ) {
        fail('the first start does not move it to INVESTIGATING');
      }
    } else if (investigating.length !== 0) {
      fail('INVESTIGATING with nobody responding');
    }

    const resolution = statusChanges.filter(
      (event) => event.toValue === 'RESOLVED',
    );
    const last = events.at(-1)!;

    if (incident.status === 'RESOLVED') {
      if (
        resolution.length !== 1 ||
        resolution[0] !== last ||
        !DECIDERS.has(last.actor) ||
        last.fromValue !== 'INVESTIGATING' ||
        incident.resolvedAt === null ||
        time(last.at) !== time(incident.resolvedAt) ||
        incident.resolution === null ||
        last.message !== incident.resolution
      ) {
        fail('the resolution is not a decider resolving, last, with its note');
      }

      if (incident.responders.some((r) => r.completedAt === null)) {
        fail('resolved while a responder is investigating');
      }
    } else {
      if (
        resolution.length !== 0 ||
        incident.resolvedAt !== null ||
        incident.resolution !== null
      ) {
        fail('active, but carries a resolution');
      }

      if (
        (incident.status === 'DECLARED') !==
        (incident.responders.length === 0)
      ) {
        fail('the status does not match whether anyone has started');
      }
    }

    if (statusChanges.length !== investigating.length + resolution.length) {
      fail('an unexpected status change');
    }
  });

  return problems;
};
