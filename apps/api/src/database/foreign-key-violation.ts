import { Prisma } from '../generated/prisma/client.js';

/** Postgres foreign-key violation, as Prisma reports it. */
const FOREIGN_KEY_VIOLATION = 'P2003';

/**
 * Names the constraint a foreign-key violation came from, or returns undefined
 * when `error` is not a foreign-key violation at all.
 *
 * The counterpart of uniqueViolationHint, for the same reason: Prisma reports
 * the constraint in different places depending on how it reached the database.
 * The classic engine puts it in `meta.field_name`; the Prisma 7 driver adapter
 * this project uses puts it under `meta.driverAdapterError.cause.constraint`.
 * Both are read, and the result is a lowercase haystack for callers to match
 * by substring. A caller rethrows anything it does not recognise.
 */
export const foreignKeyViolationHint = (error: unknown): string | undefined => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== FOREIGN_KEY_VIOLATION
  ) {
    return undefined;
  }

  const meta = error.meta as Record<string, unknown> | undefined;
  const hints: string[] = [];
  const fieldName = meta?.field_name;

  if (typeof fieldName === 'string') {
    hints.push(fieldName);
  }

  const cause = (meta?.driverAdapterError as { cause?: unknown } | undefined)
    ?.cause as
    { constraint?: { index?: string; fields?: string[] } } | undefined;

  if (cause?.constraint?.index) {
    hints.push(cause.constraint.index);
  }

  if (Array.isArray(cause?.constraint?.fields)) {
    hints.push(...cause.constraint.fields);
  }

  return hints.join(' ').toLowerCase();
};
