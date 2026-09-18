import { Prisma } from '../generated/prisma/client.js';

/** Postgres unique violation, as Prisma reports it. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Names the constraint a unique violation came from, or returns undefined when
 * `error` is not a unique violation at all.
 *
 * Two shapes, because Prisma reports this differently depending on how it
 * reached the database. The classic query engine fills `meta.target` with a
 * field list; the Prisma 7 driver adapter this project uses leaves that
 * undefined and puts the Postgres constraint name
 * (`users_email_key`) under `meta.driverAdapterError.cause.constraint`
 * instead. Reading only one of them is how a 409 silently becomes a 500.
 *
 * Returns a lowercase haystack rather than a field name: the two sources
 * disagree about whether the answer is `email` or `users_email_key`, and the
 * caller only needs to know which constraint was involved. Callers match it by
 * substring and rethrow anything they do not recognise, so a violation of a
 * constraint they did not anticipate surfaces as a 500 rather than a guessed
 * 409.
 */
export const uniqueViolationHint = (error: unknown): string | undefined => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== UNIQUE_VIOLATION
  ) {
    return undefined;
  }

  const meta = error.meta as Record<string, unknown> | undefined;
  const hints: string[] = [];
  const target = meta?.target;

  if (typeof target === 'string') {
    hints.push(target);
  } else if (Array.isArray(target)) {
    hints.push(...target.map(String));
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
