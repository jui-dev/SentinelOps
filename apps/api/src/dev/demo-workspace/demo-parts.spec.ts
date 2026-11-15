import { describe, expect, it } from 'vitest';

import {
  DEMO_PART_RULES,
  DEMO_PARTS,
  dependentsOf,
  isDemoPart,
  prerequisitesOf,
} from './demo-parts.js';

describe('demo parts', () => {
  it('should require exactly the accounts, teams and services', () => {
    expect(DEMO_PARTS.filter((part) => DEMO_PART_RULES[part].required)).toEqual(
      ['accounts', 'teams', 'services'],
    );
  });

  it('should need only parts that come before it', () => {
    for (const part of DEMO_PARTS) {
      for (const need of DEMO_PART_RULES[part].needs) {
        expect(DEMO_PARTS.indexOf(need)).toBeLessThan(DEMO_PARTS.indexOf(part));
      }
    }
  });

  it('should never let a required part need an optional one', () => {
    for (const part of DEMO_PARTS.filter((p) => DEMO_PART_RULES[p].required)) {
      for (const need of prerequisitesOf(part)) {
        expect(DEMO_PART_RULES[need].required).toBe(true);
      }
    }
  });

  it('should list what a part needs, first things first', () => {
    expect(prerequisitesOf('accounts')).toEqual([]);
    expect(prerequisitesOf('services')).toEqual(['accounts', 'teams']);
    expect(prerequisitesOf('analyses')).toEqual([
      'accounts',
      'teams',
      'services',
      'history',
    ]);
  });

  it('should list what goes with a part, the furthest first', () => {
    expect(dependentsOf('analyses')).toEqual([]);
    expect(dependentsOf('history')).toEqual(['analyses']);
    // A known issue is only used: removing them leaves the history.
    expect(dependentsOf('knownIssues')).toEqual([]);
    expect(dependentsOf('teams').at(-1)).toBe('services');
    expect(dependentsOf('teams').indexOf('analyses')).toBeLessThan(
      dependentsOf('teams').indexOf('history'),
    );
  });

  it('should know its own parts', () => {
    expect(isDemoPart('history')).toBe(true);
    expect(isDemoPart('incidents')).toBe(false);
  });
});
