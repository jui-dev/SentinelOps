import { z } from "zod";

/**
 * The browser-visible configuration, validated once when the module loads.
 *
 * `NEXT_PUBLIC_*` values are inlined into the bundle at build time, and only
 * when referenced literally as `process.env.NEXT_PUBLIC_…` — a dynamic lookup
 * is never replaced. That is why the raw value is read by name below rather
 * than by passing `process.env` in.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z
    .url({
      protocol: /^https?$/,
      error: "must be an http(s) URL",
    })
    .refine(
      (value) => {
        // Refinements still run when the URL check above has failed; that
        // failure has already been reported.
        if (!URL.canParse(value)) return true;

        const url = new URL(value);

        return url.pathname === "/" && !url.search && !url.hash;
      },
      {
        error: "must be the API origin only, e.g. http://localhost:3001",
      },
    ),
});

export interface PublicEnv {
  /** The API origin, e.g. `http://localhost:3001`. */
  apiOrigin: string;
  /** Every API path is relative to this: the origin plus the global prefix. */
  apiBaseUrl: string;
}

/** Validates raw values. Throws naming every problem, so a bad build fails fast. */
export const parsePublicEnv = (raw: Record<string, unknown>): PublicEnv => {
  const result = publicEnvSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Web configuration error: ${problems}`);
  }

  const apiOrigin = new URL(result.data.NEXT_PUBLIC_API_URL).origin;

  return { apiOrigin, apiBaseUrl: `${apiOrigin}/api/v1` };
};

export const env: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
