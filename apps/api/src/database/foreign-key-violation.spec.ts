import { Prisma } from '../generated/prisma/client.js';
import { foreignKeyViolationHint } from './foreign-key-violation.js';

const knownError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('failed', {
    code,
    clientVersion: 'test',
    meta,
  });

describe('foreignKeyViolationHint', () => {
  it('should read the constraint the driver adapter reports', () => {
    const error = knownError('P2003', {
      driverAdapterError: {
        cause: {
          constraint: {
            index: 'team_memberships_organization_id_team_id_fkey',
          },
        },
      },
    });

    expect(foreignKeyViolationHint(error)).toBe(
      'team_memberships_organization_id_team_id_fkey',
    );
  });

  it('should read the field name the classic engine reports', () => {
    expect(
      foreignKeyViolationHint(
        knownError('P2003', {
          field_name: 'Team_Memberships_Organization_Id_Membership_Id_Fkey',
        }),
      ),
    ).toBe('team_memberships_organization_id_membership_id_fkey');
  });

  it('should return an empty hint for a violation that names nothing', () => {
    expect(foreignKeyViolationHint(knownError('P2003'))).toBe('');
  });

  it('should return undefined for anything that is not a foreign-key violation', () => {
    expect(foreignKeyViolationHint(knownError('P2002'))).toBeUndefined();
    expect(foreignKeyViolationHint(new Error('P2003'))).toBeUndefined();
    expect(foreignKeyViolationHint(undefined)).toBeUndefined();
  });
});
