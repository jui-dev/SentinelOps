import { describe, expect, it } from 'vitest';

import {
  nextResponseAccess,
  startRefusal,
} from './incidents.response-access.js';

describe('startRefusal', () => {
  const on = { onResponsibleTeam: true, assigned: true };

  it('should admit nobody until the Admin chooses', () => {
    expect(startRefusal({ responseAccess: 'PENDING', ...on })).toBe(
      'awaiting-decision',
    );
  });

  it('should admit the responsible team when open, whoever is assigned', () => {
    expect(startRefusal({ responseAccess: 'OPEN', ...on })).toBeNull();
    expect(
      startRefusal({
        responseAccess: 'OPEN',
        onResponsibleTeam: false,
        assigned: true,
      }),
    ).toBe('not-on-team');
  });

  it('should admit only the assigned when assigned, whatever their team', () => {
    expect(
      startRefusal({
        responseAccess: 'ASSIGNED',
        onResponsibleTeam: false,
        assigned: true,
      }),
    ).toBeNull();
    expect(
      startRefusal({
        responseAccess: 'ASSIGNED',
        onResponsibleTeam: true,
        assigned: false,
      }),
    ).toBe('not-assigned');
  });
});

describe('nextResponseAccess', () => {
  const assigned = (...ids: string[]) =>
    ids.map((membershipId) => ({ membershipId }));

  it('should clear who was assigned on opening to the team', () => {
    expect(
      nextResponseAccess(
        { assignees: assigned('a'), responders: [] },
        { mode: 'OPEN' },
      ),
    ).toEqual({ responseAccess: 'OPEN', assigneeIds: [] });
  });

  it('should replace who was assigned with who is named', () => {
    expect(
      nextResponseAccess(
        { assignees: assigned('a'), responders: [] },
        { mode: 'ASSIGNED', membershipIds: ['b', 'c'] },
      ),
    ).toEqual({ responseAccess: 'ASSIGNED', assigneeIds: ['b', 'c'] });
  });

  it('should return to undecided when nobody is left', () => {
    expect(
      nextResponseAccess(
        { assignees: assigned('a'), responders: [] },
        { mode: 'ASSIGNED', membershipIds: [] },
      ),
    ).toEqual({ responseAccess: 'PENDING', assigneeIds: [] });
  });

  it('should keep whoever is investigating, assigned or not, once each', () => {
    expect(
      nextResponseAccess(
        {
          assignees: [],
          responders: [{ membershipId: 'a', status: 'INVESTIGATING' }],
        },
        { mode: 'ASSIGNED', membershipIds: ['a', 'b'] },
      ),
    ).toEqual({ responseAccess: 'ASSIGNED', assigneeIds: ['a', 'b'] });
    expect(
      nextResponseAccess(
        {
          assignees: [],
          responders: [{ membershipId: 'a', status: 'INVESTIGATING' }],
        },
        { mode: 'ASSIGNED', membershipIds: [] },
      ),
    ).toEqual({ responseAccess: 'ASSIGNED', assigneeIds: ['a'] });
  });

  it('should keep an assignee who finished, but not a team member who did', () => {
    expect(
      nextResponseAccess(
        {
          assignees: assigned('a'),
          responders: [
            { membershipId: 'a', status: 'COMPLETED' },
            { membershipId: 'b', status: 'COMPLETED' },
          ],
        },
        { mode: 'ASSIGNED', membershipIds: ['c'] },
      ),
    ).toEqual({ responseAccess: 'ASSIGNED', assigneeIds: ['c', 'a'] });
  });
});
