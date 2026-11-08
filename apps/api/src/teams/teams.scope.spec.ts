import { teamReadScope, withinTeamScope } from './teams.scope.js';

const ORG = '0199a1b2-c3d4-7000-8000-00000000000a';
const OTHER_ORG = '0199a1b2-c3d4-7000-8000-00000000000b';
const MEMBERSHIP = '0199a1b2-c3d4-7000-8000-0000000000aa';
const TEAM = '0199a1b2-c3d4-7000-8000-0000000000ba';
const ADMIN = { membershipId: MEMBERSHIP, role: 'ADMIN' as const };
const MEMBER = { membershipId: MEMBERSHIP, role: 'MEMBER' as const };
const ISOLATION = { organizationId: ORG, organization: { deletedAt: null } };

describe('teamReadScope', () => {
  it('should narrow nothing for whoever may see every team', () => {
    expect(teamReadScope(ADMIN)).toBeUndefined();
  });

  it('should narrow a member to the teams they are on now', () => {
    expect(teamReadScope(MEMBER)).toEqual({
      memberships: { some: { membershipId: MEMBERSHIP } },
    });
  });

  it('should narrow a role it does not recognise, never widen it', () => {
    // hasPermission denies an unknown role, so it sees only its own teams.
    expect(
      teamReadScope({ membershipId: MEMBERSHIP, role: 'OWNER' as never }),
    ).toEqual(teamReadScope(MEMBER));
  });

  it('should never consult an incident, a response, or an analysis', () => {
    // Team visibility is current placement, not incident participation: a
    // member who responded to an incident the team no longer has, or who
    // owns its analysis, keeps the incident and not the team.
    const scope = JSON.stringify(teamReadScope(MEMBER));

    expect(scope).not.toContain('incident');
    expect(scope).not.toContain('responder');
    expect(scope).not.toContain('analysis');
  });
});

describe('withinTeamScope', () => {
  it('should keep the organization, and add nothing else, for an admin', () => {
    expect(withinTeamScope(ORG, ADMIN, { id: TEAM })).toEqual({
      AND: [ISOLATION, { id: TEAM }],
    });
  });

  it("should add a member's scope as its own condition", () => {
    expect(withinTeamScope(ORG, MEMBER, { id: TEAM })).toEqual({
      AND: [ISOLATION, teamReadScope(MEMBER), { id: TEAM }],
    });
  });

  it('should keep the organization with no further conditions', () => {
    expect(withinTeamScope(ORG, MEMBER)).toEqual({
      AND: [ISOLATION, teamReadScope(MEMBER), {}],
    });
  });

  it("should never let a caller's OR or AND displace the scope", () => {
    // A cursor's OR and a search's AND: spread into one object with the
    // scope, either would replace the other's key.
    const page = {
      OR: [{ name: { gt: 'Payments' } }],
      AND: [{ name: { contains: 'plat' } }],
    };

    const where = withinTeamScope(ORG, MEMBER, page);

    expect(where).toEqual({ AND: [ISOLATION, teamReadScope(MEMBER), page] });
    expect(Object.keys(where)).toEqual(['AND']);
  });

  it("should never let a caller's organization widen the isolation", () => {
    // Both conditions apply: another organization can only narrow to
    // nothing, never replace the admitted one.
    expect(
      withinTeamScope(ORG, MEMBER, { organizationId: OTHER_ORG }).AND,
    ).toEqual([
      ISOLATION,
      teamReadScope(MEMBER),
      { organizationId: OTHER_ORG },
    ]);
  });

  it("should never let a caller's memberships predicate displace the scope", () => {
    // The one predicate that could widen by name: as its own element it can
    // only narrow, and the scope's own membership condition still applies.
    const caller = { memberships: { some: { membershipId: 'someone-else' } } };

    expect(withinTeamScope(ORG, MEMBER, caller)).toEqual({
      AND: [ISOLATION, teamReadScope(MEMBER), caller],
    });
  });
});
