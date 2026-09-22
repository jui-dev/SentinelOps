import { incidentReadScope, withinIncidentScope } from './incidents.scope.js';

const ORG = '0199a1b2-c3d4-7000-8000-00000000000a';
const OTHER_ORG = '0199a1b2-c3d4-7000-8000-00000000000b';
const MEMBERSHIP = '0199a1b2-c3d4-7000-8000-0000000000aa';
const ADMIN = { membershipId: MEMBERSHIP, role: 'ADMIN' as const };
const MEMBER = { membershipId: MEMBERSHIP, role: 'MEMBER' as const };
const ISOLATION = { organizationId: ORG, organization: { deletedAt: null } };

describe('incidentReadScope', () => {
  it('should narrow nothing for whoever may read every incident', () => {
    expect(incidentReadScope(ADMIN)).toBeUndefined();
  });

  it("should narrow a member to their teams', responses', and analyses' incidents", () => {
    expect(incidentReadScope(MEMBER)).toEqual({
      OR: [
        { team: { memberships: { some: { membershipId: MEMBERSHIP } } } },
        { responders: { some: { membershipId: MEMBERSHIP } } },
        { analysis: { is: { ownerMembershipId: MEMBERSHIP } } },
      ],
    });
  });

  it('should narrow a role it does not recognise, never widen it', () => {
    // hasPermission denies an unknown role, so it reads only its own.
    expect(
      incidentReadScope({ membershipId: MEMBERSHIP, role: 'OWNER' as never }),
    ).toEqual(incidentReadScope(MEMBER));
  });

  it("should never consult the service's owner", () => {
    expect(JSON.stringify(incidentReadScope(MEMBER))).not.toContain('service');
  });
});

describe('withinIncidentScope', () => {
  it('should keep the organization, and add nothing else, for an admin', () => {
    expect(withinIncidentScope(ORG, ADMIN, { number: 7 })).toEqual({
      AND: [ISOLATION, { number: 7 }],
    });
  });

  it("should add a member's scope as its own condition", () => {
    expect(withinIncidentScope(ORG, MEMBER, { number: 7 })).toEqual({
      AND: [ISOLATION, incidentReadScope(MEMBER), { number: 7 }],
    });
  });

  it('should keep the organization with no further conditions', () => {
    expect(withinIncidentScope(ORG, MEMBER)).toEqual({
      AND: [ISOLATION, incidentReadScope(MEMBER), {}],
    });
  });

  it("should never let a caller's OR or AND displace the scope", () => {
    // A cursor's OR and a search's AND: spread into one object with the
    // scope, either would replace the other's key.
    const page = {
      OR: [{ number: { gt: 41 } }],
      AND: [{ title: { contains: 'payments' } }],
    };

    const where = withinIncidentScope(ORG, MEMBER, page);

    expect(where).toEqual({
      AND: [ISOLATION, incidentReadScope(MEMBER), page],
    });
    expect(Object.keys(where)).toEqual(['AND']);
  });

  it("should never let a caller's organization widen the isolation", () => {
    // Both conditions apply: another organization can only narrow to
    // nothing, never replace the admitted one.
    expect(
      withinIncidentScope(ORG, MEMBER, { organizationId: OTHER_ORG }).AND,
    ).toEqual([
      ISOLATION,
      incidentReadScope(MEMBER),
      { organizationId: OTHER_ORG },
    ]);
  });
});
