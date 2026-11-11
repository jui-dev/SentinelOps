import { buildDemoHistory } from './build-demo-history.js';
import { buildDemoKnownIssues } from './demo-known-issues.js';
import { SCENARIOS } from './demo-story.js';

describe('the demo known issues', () => {
  const history = buildDemoHistory(new Date('2026-09-20T00:00:00.000Z'));
  const issues = buildDemoKnownIssues(history);
  const byName = (name: string) => issues.find((issue) => issue.name === name);

  it('should keep every problem that recurs, each with all its incidents', () => {
    const recurring = issues.filter((issue) => !issue.pendingReview);

    expect(recurring.length).toBeGreaterThanOrEqual(8);
    for (const issue of recurring) {
      expect(issue.incidents.length).toBeGreaterThan(1);
      for (const number of issue.incidents) {
        expect(history[number - 1].service).toBe(issue.service);
      }
    }
  });

  it('should leave a problem seen once a one-off', () => {
    const once = Object.values(SCENARIOS)
      .flat()
      .find(
        ({ title }) =>
          history.filter((incident) => incident.title === title).length === 1 &&
          title !== 'Merchant webhook deliveries delayed',
      );

    expect(once && byName(once.title)).toBeUndefined();
  });

  it('should tie the active webhook incident to its earlier problem, and keep one for review', () => {
    const webhooks = history.find(
      ({ title }) => title === 'Webhook retries backing up for some merchants',
    )!;

    expect(byName('Merchant webhook deliveries delayed')?.incidents).toContain(
      webhooks.number,
    );
    expect(byName('Elevated card declines from one acquirer')).toMatchObject({
      pendingReview: true,
      incidents: [
        history.find(
          ({ title }) => title === 'Elevated card declines from one acquirer',
        )!.number,
      ],
    });
  });

  it('should link each incident to one known issue at most', () => {
    const linked = issues.flatMap((issue) => issue.incidents);

    expect(new Set(linked).size).toBe(linked.length);
  });
});
