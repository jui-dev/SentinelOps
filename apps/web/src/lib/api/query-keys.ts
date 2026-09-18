/**
 * Query keys, in one place so an invalidation names exactly what it means.
 *
 * - `me`: the user and their memberships, each with its organization's name
 *   and slug. Drives the organization picker, switcher, and slug resolution.
 * - `organization`: one organization and the caller's role and permissions.
 * - `memberships`: an organization's membership records. Carries no
 *   organization fields, so nothing about the organization itself stales it.
 * - `invitations`: an organization's open invitations. Creating or revoking
 *   one stales only this.
 *
 * The invitation an `/invite` page shows is deliberately not cached here: it
 * is fetched with a token, and lives in that page's own state.
 */
export const queryKeys = {
  me: ["me"] as const,
  organization: (organizationId: string) =>
    ["organization", organizationId] as const,
  memberships: (organizationId: string) =>
    ["organization", organizationId, "memberships"] as const,
  invitations: (organizationId: string) =>
    ["organization", organizationId, "invitations"] as const,
};
