import {
  mayWriteAnalysis,
  nextDoneSections,
} from './incident-analyses.policy.js';

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

describe('nextDoneSections', () => {
  const draft = {
    summary: 'What happened.',
    impact: 'Who it hit.',
    cause: null,
    lessons: null,
    doneSections: ['summary'],
  };

  it('should keep what is done when the edit does not touch it', () => {
    expect(nextDoneSections(draft, { impact: 'Everyone.' })).toEqual([
      'summary',
    ]);
  });

  it('should mark a written section done, in reading order', () => {
    expect(
      nextDoneSections(
        { ...draft, doneSections: ['impact'] },
        { markDone: ['summary'] },
      ),
    ).toEqual(['summary', 'impact']);
  });

  it('should mark a section done in the same edit that writes it', () => {
    expect(
      nextDoneSections(draft, {
        cause: 'An expired key.',
        markDone: ['cause'],
      }),
    ).toEqual(['summary', 'cause']);
  });

  it('should reopen a section', () => {
    expect(nextDoneSections(draft, { reopen: ['summary'] })).toEqual([]);
  });

  it('should un-mark a done section whose text changes', () => {
    expect(nextDoneSections(draft, { summary: 'Something else.' })).toEqual([]);
  });

  it('should keep a done section sent again with the same text', () => {
    expect(nextDoneSections(draft, { summary: 'What happened.' })).toEqual([
      'summary',
    ]);
  });

  it('should un-mark a done section that is cleared', () => {
    expect(nextDoneSections(draft, { summary: null })).toEqual([]);
  });

  it('should refuse to mark done a section with no text', () => {
    expect(nextDoneSections(draft, { markDone: ['cause'] })).toBeNull();
    expect(
      nextDoneSections(draft, { summary: null, markDone: ['summary'] }),
    ).toBeNull();
  });
});
