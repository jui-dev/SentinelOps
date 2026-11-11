/**
 * TEMPORARY — the demo's known issues, derived from its history: plain data
 * that DemoHistoryService writes alongside the incidents. Pure, so which
 * incidents each one gathers is tested without a database.
 */
import type { DemoIncident } from './build-demo-history.js';
import {
  KNOWN_ISSUE_LINKS,
  SAVED_WHILE_DECLARING,
  SCENARIOS,
} from './demo-story.js';
import type { DemoService, Severity } from './demo-story.js';

export interface DemoKnownIssue {
  service: DemoService;
  name: string;
  description: string;
  usualSeverity: Severity;
  pendingReview: boolean;
  /** Its incidents, by number, oldest first. */
  incidents: number[];
}

const SERVICES = Object.keys(SCENARIOS) as DemoService[];

/**
 * See demo-story.ts: every scenario that recurs, the active incidents tied
 * to one, and those saved while declaring. Each incident is in one at most.
 */
export const buildDemoKnownIssues = (
  history: readonly DemoIncident[],
): DemoKnownIssue[] => {
  const numbersOf = (service: DemoService, title: string) =>
    history
      .filter(
        (incident) => incident.service === service && incident.title === title,
      )
      .map(({ number }) => number);

  const fromScenarios = SERVICES.flatMap((service) =>
    SCENARIOS[service].flatMap((scenario) => {
      const linked = KNOWN_ISSUE_LINKS.filter(
        (link) =>
          link.service === service && link.knownIssue === scenario.title,
      ).flatMap((link) => numbersOf(service, link.title));
      const incidents = [...numbersOf(service, scenario.title), ...linked].sort(
        (a, b) => a - b,
      );

      return incidents.length > 1
        ? [
            {
              service,
              name: scenario.title,
              description: scenario.summary,
              usualSeverity: scenario.severities[0],
              pendingReview: false,
              incidents,
            },
          ]
        : [];
    }),
  );

  const saved = SAVED_WHILE_DECLARING.flatMap((title) => {
    const incident = history.find((candidate) => candidate.title === title);

    return incident
      ? [
          {
            service: incident.service,
            name: incident.title,
            description: incident.summary,
            usualSeverity: incident.severity,
            pendingReview: true,
            incidents: [incident.number],
          },
        ]
      : [];
  });

  return [...fromScenarios, ...saved];
};
