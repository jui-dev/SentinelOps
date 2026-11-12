import { z } from 'zod';

import { resourceIdSchema } from '../tenancy/tenancy.schemas.js';
import { CHANGE_AREAS } from './activity.actions.js';

/**
 * A page of the log.
 *
 *   view     `changes` (the default) — the organization's setup — or
 *            `security`: sign-ins and passwords.
 *   area     one area of the Changes view. Not on the Security view, which
 *            is one area already.
 *   result   one kind of sign-in event, on the Security view only.
 *   actorId  done by one person — for a sign-in, whose account it was.
 *   q        names containing this, in any case: who did it, or what it was
 *            done to.
 *   since    on or after this moment. The period is chosen by the client,
 *            which knows the Admin's day; the server takes the instant.
 *   cursor   from a previous page's `nextCursor`.
 *
 * The page size is not a client parameter, as for notifications.
 */
export const listActivityQuerySchema = z
  .strictObject({
    view: z.enum(['changes', 'security']).default('changes'),
    area: z.enum(CHANGE_AREAS).optional(),
    result: z
      .enum([
        'SIGNED_IN',
        'SIGN_IN_FAILED',
        'SIGN_IN_BLOCKED',
        'PASSWORD_CHANGED',
      ])
      .optional(),
    actorId: resourceIdSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().min(1).max(100).optional(),
  })
  .refine((query) => query.view === 'changes' || query.area === undefined, {
    message: 'An area applies to the Changes view only',
    path: ['area'],
  })
  .refine((query) => query.view === 'security' || query.result === undefined, {
    message: 'A result applies to the Security view only',
    path: ['result'],
  });

export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;
