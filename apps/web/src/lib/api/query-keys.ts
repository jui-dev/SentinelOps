/**
 * Query keys, in one place so an invalidation names exactly what it means.
 *
 * - `me`: the user and their memberships, each with its organization's name
 *   and slug. Drives the organization picker, switcher, and slug resolution.
 * - `organization`: one organization and the caller's role and permissions.
 * - `memberships`: an organization's membership records. Carries no
 *   organization fields, so nothing about the organization itself stales it.
 */
export const queryKeys = {
  me: ["me"] as const,
  organization: (organizationId: string) =>
    ["organization", organizationId] as const,
  memberships: (organizationId: string) =>
    ["organization", organizationId, "memberships"] as const,
};
