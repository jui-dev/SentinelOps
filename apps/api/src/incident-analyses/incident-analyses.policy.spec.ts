import { mayWriteAnalysis } from './incident-analyses.policy.js';

const OWNER = 'membership-owner';
const OTHER = 'membership-other';
const analysis = { ownerMembershipId: OWNER };

describe('mayWriteAnalysis', () => {
  it('should let the owner write their analysis, whatever their role', () => {
    expect(
      mayWriteAnalysis({ membershipId: OWNER, role: 'MEMBER' }, analysis),
    ).toBe(true);
    expect(
      mayWriteAnalysis({ membershipId: OWNER, role: 'ADMIN' }, analysis),
    ).toBe(true);
  });

  it("should let whoever runs incidents' lifecycles write any analysis", () => {
    expect(
      mayWriteAnalysis({ membershipId: OTHER, role: 'ADMIN' }, analysis),
    ).toBe(true);
  });

  it('should refuse a member who does not own it', () => {
    expect(
      mayWriteAnalysis({ membershipId: OTHER, role: 'MEMBER' }, analysis),
    ).toBe(false);
  });

  it('should refuse a role it does not recognise, even as owner', () => {
    expect(
      mayWriteAnalysis(
        { membershipId: OWNER, role: 'OWNER' as never },
        analysis,
      ),
    ).toBe(false);
  });
});
