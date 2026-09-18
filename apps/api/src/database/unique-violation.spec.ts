import { Prisma } from '../generated/prisma/client.js';
import { uniqueViolationHint } from './unique-violation.js';

const knownError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('failed', {
    code,
    clientVersion: 'test',
    meta,
  });

describe('uniqueViolationHint', () => {
  it('should read the constraint name the driver adapter reports', () => {
    const error = knownError('P2002', {
      driverAdapterError: {
        cause: {
          constraint: {
            index: 'invitations_open_organization_email_key',
            fields: ['organization_id', 'email'],
          },
        },
      },
    });

    expect(uniqueViolationHint(error)).toBe(
      'invitations_open_organization_email_key organization_id email',
    );
  });

  it('should read the field list the classic engine reports', () => {
    expect(
      uniqueViolationHint(knownError('P2002', { target: ['Email'] })),
    ).toBe('email');
    expect(
      uniqueViolationHint(knownError('P2002', { target: 'users_email_key' })),
    ).toBe('users_email_key');
  });

  it('should return an empty hint for a unique violation that names nothing', () => {
    expect(uniqueViolationHint(knownError('P2002'))).toBe('');
  });

  it.each([
    ['another Prisma error', knownError('P2025')],
    ['a plain error', new Error('P2002')],
    ['a non-error', 'P2002'],
  ])('should return undefined for %s', (_label, error) => {
    expect(uniqueViolationHint(error)).toBeUndefined();
  });
});
