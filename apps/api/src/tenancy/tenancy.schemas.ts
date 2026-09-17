import { z } from 'zod';

/**
 * The shape of every primary key in this schema: a uuid.
 *
 * Checked before an id from a URL reaches a query. Postgres refuses to cast a
 * malformed value to `uuid`, and that refusal would surface as a masked 500
 * where the honest answer is that no such thing exists.
 */
export const resourceIdSchema = z.uuid();

export const isResourceId = (value: unknown): value is string =>
  resourceIdSchema.safeParse(value).success;
