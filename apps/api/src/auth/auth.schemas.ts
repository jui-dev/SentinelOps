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
 * forgiving path is to omit it and let `slugify` (common/slug.ts) derive one.
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

/** A person's display name. Shared by both ways of creating an account. */
export const personNameSchema = z.string().trim().min(1).max(100);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: personNameSchema,
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
