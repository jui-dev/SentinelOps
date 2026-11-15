/**
 * TEMPORARY, like the rest of src/dev — the parts a demo organization is
 * made of, and what each needs.
 *
 * Two kinds. The required parts are what SentinelOps needs to work at all:
 * without its accounts nobody signs in, without teams no Responder sees an
 * incident, without services none can be declared. The optional parts only
 * make it look lived-in, and each can be generated or removed on its own.
 *
 * Pure, so the rules are tested apart from the database.
 */

export const DEMO_PARTS = [
  'accounts',
  'teams',
  'services',
  'knownIssues',
  'history',
  'live',
  'analyses',
  'activity',
] as const;

export type DemoPart = (typeof DEMO_PARTS)[number];

export const isDemoPart = (value: string): value is DemoPart =>
  (DEMO_PARTS as readonly string[]).includes(value);

export interface DemoPartRule {
  /** Needed for SentinelOps to work; never removed on its own. */
  required: boolean;
  /** What must exist first. */
  needs: readonly DemoPart[];
  /**
   * What it uses when it is there, but can go without: incidents name a
   * known issue when there are some.
   */
  uses: readonly DemoPart[];
}

export const DEMO_PART_RULES: Record<DemoPart, DemoPartRule> = {
  accounts: { required: true, needs: [], uses: [] },
  teams: { required: true, needs: ['accounts'], uses: [] },
  services: { required: true, needs: ['teams'], uses: [] },
  knownIssues: { required: false, needs: ['services'], uses: [] },
  history: {
    required: false,
    needs: ['teams', 'services'],
    uses: ['knownIssues'],
  },
  live: { required: false, needs: ['teams', 'services'], uses: [] },
  analyses: { required: false, needs: ['history'], uses: [] },
  // Its entries name the teams and services changed.
  activity: { required: false, needs: ['services'], uses: [] },
};

/** Every part `part` needs, directly or not, first things first. */
export const prerequisitesOf = (part: DemoPart): DemoPart[] => {
  const order: DemoPart[] = [];
  const visit = (current: DemoPart) => {
    for (const need of DEMO_PART_RULES[current].needs) {
      visit(need);
      if (!order.includes(need)) order.push(need);
    }
  };

  visit(part);

  return order;
};

/**
 * Every part that needs `part`, directly or not — what goes with it when it
 * is removed — the furthest first, so each is removed before what it needs.
 */
export const dependentsOf = (part: DemoPart): DemoPart[] => {
  const found: DemoPart[] = [];
  const visit = (current: DemoPart) => {
    for (const candidate of DEMO_PARTS) {
      if (
        DEMO_PART_RULES[candidate].needs.includes(current) &&
        !found.includes(candidate)
      ) {
        found.push(candidate);
        visit(candidate);
      }
    }
  };

  visit(part);

  return found.reverse();
};
