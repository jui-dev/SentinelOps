/**
 * The third defence against persistence internals reaching a client, shared by
 * every integration suite: a walk over a response body that fails on any key a
 * response must never carry. See "Responses never carry persistence internals"
 * in the README.
 */

/** Keys that must never appear anywhere in a response body. */
export const FORBIDDEN_KEYS = [
  'passwordHash',
  'password_hash',
  'password',
  'tokenHash',
  'token_hash',
  'refreshToken',
  'refresh_token',
  'familyId',
  'family_id',
  'deletedAt',
  'deleted_at',
  'revokedAt',
  'revoked_at',
  'lastIncidentNumber',
  'last_incident_number',
];

/**
 * Walks a response body and returns every forbidden key it holds, at any depth.
 *
 * The guard against a future migration adding a sensitive column and a careless
 * mapper spreading it into a response. It fails the test rather than shipping.
 */
export const leakedKeys = (value: unknown, path = ''): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      leakedKeys(entry, `${path}[${index}]`),
    );
  }

  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    const here = path ? `${path}.${key}` : key;
    const found = FORBIDDEN_KEYS.includes(key) ? [here] : [];

    return [...found, ...leakedKeys(nested, here)];
  });
};
