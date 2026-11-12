import { runWithRequestContext } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { changedFields, recordActivity } from './activity.recorder.js';

const fakeTx = () => {
  const create = vi.fn();
  const tx = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Dev Admin' }),
    },
    activityEntry: { create },
  } as unknown as Prisma.TransactionClient;

  return { tx, create };
};

describe('recordActivity', () => {
  it('should take the area from the action, the name from the account, and where from the request', async () => {
    const { tx, create } = fakeTx();

    await runWithRequestContext(
      {
        requestId: 'req-1',
        client: { ipAddress: '10.0.4.2', userAgent: 'Firefox/132.0' },
      },
      () =>
        recordActivity(tx, {
          organizationId: 'org-1',
          action: 'ROLE_CHANGED',
          actorId: 'user-1',
          subject: { type: 'MEMBERSHIP', id: 'm-1', name: 'Sam Okafor' },
          changes: [
            { field: 'role', before: 'RESPONDER', after: 'INCIDENT_MANAGER' },
          ],
        }),
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        action: 'ROLE_CHANGED',
        area: 'PEOPLE',
        actorId: 'user-1',
        actorName: 'Dev Admin',
        subjectType: 'MEMBERSHIP',
        subjectId: 'm-1',
        subjectName: 'Sam Okafor',
        changes: [
          { field: 'role', before: 'RESPONDER', after: 'INCIDENT_MANAGER' },
        ],
        ipAddress: '10.0.4.2',
        userAgent: 'Firefox/132.0',
      },
    });
  });

  it('should record no address outside a request, and no subject when there is none', async () => {
    const { tx, create } = fakeTx();

    await recordActivity(tx, {
      organizationId: 'org-1',
      action: 'SIGNED_IN',
      actorId: 'user-1',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        area: 'SECURITY',
        subjectType: null,
        subjectId: null,
        subjectName: null,
        changes: [],
        ipAddress: null,
        userAgent: null,
      }),
    });
  });
});

describe('changedFields', () => {
  it('should drop a field whose value did not change', () => {
    expect(
      changedFields([
        { field: 'name', before: 'Risk', after: 'Risk' },
        { field: 'description', before: null, after: 'Fraud and limits' },
      ]),
    ).toEqual([
      { field: 'description', before: null, after: 'Fraud and limits' },
    ]);
  });
});
