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
 * - `teams`: an organization's teams, each with its member count. Team pages
 *   read the team from here too, so any change to a team or to who is on it
 *   stales this.
 * - `teamMembers`: who is on one team. Adding or removing someone stales it
 *   and `teams` (the count).
 * - `services`: an organization's services, each embedding its owning team's
 *   name. Service pages read the service from here. Any service change stales
 *   it and `teams` (each team's service count); a team rename stales it too.
 * - `incidents`: the prefix of every incident query in an organization —
 *   both paged lists (`incidentList`) and each incident (`incident`). Every
 *   incident embeds its service's name, criticality, and archival, and its
 *   team's name, so a change to a service or a team rename stales the whole
 *   prefix. Declaring or changing an incident writes that incident's entry
 *   and stales the lists.
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
  teams: (organizationId: string) =>
    ["organization", organizationId, "teams"] as const,
  teamMembers: (organizationId: string, teamId: string) =>
    ["organization", organizationId, "teams", teamId, "members"] as const,
  services: (organizationId: string) =>
    ["organization", organizationId, "services"] as const,
  incidents: (organizationId: string) =>
    ["organization", organizationId, "incidents"] as const,
  incidentList: (organizationId: string, state: "active" | "resolved") =>
    ["organization", organizationId, "incidents", "list", state] as const,
  incident: (organizationId: string, number: number) =>
    ["organization", organizationId, "incidents", "detail", number] as const,
};
