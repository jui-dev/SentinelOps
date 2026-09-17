import { z } from 'zod';

/**
 * Request schemas for the auth routes, colocated with the module that owns
 * them, and consumed by the global StandardSchemaValidationPipe exactly as the
 * API conventions describe.
 *
 * Normalisation happens here rather than in the service, because this is the
 * boundary the rest of the application trusts: by the time an email reaches
 * AuthService it is already lowercase and trimmed, which is what makes the
 * case-sensitive Postgres unique index on `users.email` correct.
 */

/**
 * Trim and lowercase *before* validating the format. Order matters: applying
 * `.trim()` to `z.email()` runs the email check first, so a value with a
 * trailing space is rejected instead of cleaned.
 *
 * 254 characters is the maximum length of a deliverable address (RFC 5321).
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

/**
 * Length is the only rule. Composition requirements (a digit, a symbol, a
 * capital) push people towards `Passw0rd!` and away from the long passphrases
 * that are actually harder to guess — the position NIST SP 800-63B settled on.
 *
 * The 128-character ceiling exists to bound the work Argon2 is asked to do, not
 * because the algorithm has a limit: unlike bcrypt, which silently truncates
 * at 72 bytes, Argon2id hashes the whole input.
 */
export const passwordSchema = z.string().min(12).max(128);

/**
 * A URL-safe organization identifier. Rejected rather than silently repaired,
 * because a caller that supplies a slug explicitly cares what it is; the
 * forgiving path is to omit it and let `slugify` derive one.
 */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(2)
      .max(48)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Must be lowercase letters, digits, and single hyphens between them',
      ),
  );

/**
 * An organization's display name. Shared by registration, which names the
 * organization it creates, and by renaming one.
 */
export const organizationNameSchema = z.string().trim().min(1).max(100);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
  organizationName: organizationNameSchema,
  /** Optional: derived from organizationName when absent. */
  organizationSlug: slugSchema.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: the policy applies to passwords being *set*. Applying
  // it here would reject a login by anyone whose password predates a future
  // tightening of the rule, and would leak the policy to an attacker as a 400
  // rather than a 401.
  password: z.string().min(1).max(128),
});

export type RegisterRequest = z.infer<typeof registerSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;

/**
 * Derives a slug from an organization name.
 *
 * Returns undefined when nothing usable survives — a name of only punctuation
 * or non-Latin script. The caller turns that into a 400 asking for an explicit
 * slug, which is honest, rather than inventing `organization-1`.
 *
 * No uniqueness suffix is appended on collision. A caller who typed "Acme" and
 * silently received `acme-2` has a URL they did not choose and cannot predict;
 * a 409 lets them decide.
 */
export const slugify = (name: string): string | undefined => {
  const slug = name
    .normalize('NFKD')
    // Strip the combining marks NFKD just separated out, so a name like
    // "Ubernacht" written with an umlaut slugs to 'ubernacht' rather than
    // losing the character entirely. Escaped rather than written literally:
    // a combining mark in source is invisible and survives editing by luck.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    // A truncation at 48 can leave a trailing hyphen behind.
    .replace(/-+$/g, '');

  return slug.length >= 2 ? slug : undefined;
};
