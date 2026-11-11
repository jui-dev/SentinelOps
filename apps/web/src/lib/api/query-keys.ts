import type { IncidentFilters, IncidentHistoryFilters } from "./contracts";

/**
 * Query keys, in one place so an invalidation names exactly what it means.
 *
 * - `me`: the user and their memberships, each with its organization's name
 *   and slug. Drives the organization picker, switcher, and slug resolution.
 * - `organization`: one organization and the caller's role and permissions.
 * - `memberships`: an organization's membership records. Carries no
 *   organization fields, so nothing about the organization itself stales it.
 *   Each record lists the member's teams, so placing someone on a team or
 *   taking them off stales it.
 * - `membership`: one membership record, beneath `memberships`. Stales with
 *   it, and when that member's teams change.
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
 *   both paged lists (`incidentList`, one per state, range, and filters — a
 *   range or a filter narrowing a list is its own query) and each incident (`incident`). Every
 *   incident embeds its service's name, criticality, and archival, and its
 *   team's name, so a change to a service or a team rename stales the whole
 *   prefix. Declaring or changing an incident writes that incident's entry
 *   and stales the lists.
 * - `memberResponses`: one member's responses, beneath the prefix. Starting
 *   or completing a response stales every member's.
 * - `incidentTimeline`: one incident's timeline, beneath its entry. Posting
 *   an update or changing the incident stales it.
 * - `incidentAnalysis`: one incident's analysis — null when none is
 *   started — beneath its entry. Only its own writes change it, and each
 *   writes the API's answer here; it never moves back to an older version.
 * - `incidentActivity`: how much the organization did on each day of one
 *   period, beneath the prefix. Declaring, responding to, or resolving an
 *   incident writes a timeline entry, so it stales every period's.
 * - `incidentSummary`: the overview's counts and history for one period,
 *   beneath the prefix — so whatever stales every incident stales them too.
 *   Declaring or changing an incident stales every period's.
 * - `incidentOccurrence`: how often incidents were declared in one period,
 *   and against which services, beneath the prefix — so a service rename or
 *   archival, which it names, stales it too. Declaring or changing an
 *   incident stales every period's.
 * - `incidentParts`: the caller's active incidents counted by their own
 *   part, beneath the prefix, so whatever stales every incident stales it;
 *   others' work reaches it by polling.
 * - `incidentAttention`: the active incidents waiting on the caller, beneath
 *   the prefix. Declaring, changing, or responding to an incident stales it;
 *   what others do reaches it by polling.
 *
 * - `notifications`: the prefix of the caller's own notifications in an
 *   organization. Nothing the caller does elsewhere stales it — they are
 *   never told of their own actions — so it changes by polling and by
 *   acknowledging.
 * - `unreadNotificationCount`: how many are unread, beneath the prefix. The
 *   bell polls it. Acknowledging sets or refetches it.
 * - `notificationList`: the pages of notifications, newest first, beneath
 *   the prefix. Fetched when the panel opens; acknowledging marks rows in it.
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
  membership: (organizationId: string, membershipId: string) =>
    ["organization", organizationId, "memberships", membershipId] as const,
  invitations: (organizationId: string) =>
    ["organization", organizationId, "invitations"] as const,
  teams: (organizationId: string) =>
    ["organization", organizationId, "teams"] as const,
  teamMembers: (organizationId: string, teamId: string) =>
    ["organization", organizationId, "teams", teamId, "members"] as const,
  services: (organizationId: string) =>
    ["organization", organizationId, "services"] as const,
  /** Every known issue in the organization; each service's list sits under it. */
  knownIssues: (organizationId: string) =>
    ["organization", organizationId, "known-issues"] as const,
  incidents: (organizationId: string) =>
    ["organization", organizationId, "incidents"] as const,
  incidentList: (
    organizationId: string,
    state: "active" | "resolved",
    period?: { from: string; to: string },
    filters: IncidentFilters = {},
  ) =>
    [
      "organization",
      organizationId,
      "incidents",
      "list",
      state,
      period ? `${period.from}..${period.to}` : "all",
      // Only the filters in use, so an unfiltered list is one key however
      // it was asked for.
      Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== undefined),
      ),
    ] as const,
  incidentSummary: (organizationId: string, from: string, to: string) =>
    ["organization", organizationId, "incidents", "summary", from, to] as const,
  incidentHistory: (
    organizationId: string,
    from: string,
    to: string,
    filters: IncidentHistoryFilters = {},
  ) =>
    [
      "organization",
      organizationId,
      "incidents",
      "history",
      from,
      to,
      Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== undefined),
      ),
    ] as const,
  memberActivity: (
    organizationId: string,
    membershipId: string,
    from: string,
    to: string,
  ) =>
    [
      "organization",
      organizationId,
      "memberships",
      membershipId,
      "activity",
      from,
      to,
    ] as const,
  incidentFlow: (organizationId: string, days: number) =>
    ["organization", organizationId, "incidents", "flow", days] as const,
  incidentActivity: (organizationId: string, from: string, to: string) =>
    ["organization", organizationId, "incidents", "activity", from, to] as const,
  incidentOccurrence: (organizationId: string, from: string, to: string) =>
    ["organization", organizationId, "incidents", "occurrence", from, to] as const,
  incidentAttention: (organizationId: string) =>
    ["organization", organizationId, "incidents", "attention"] as const,
  incidentParts: (organizationId: string) =>
    ["organization", organizationId, "incidents", "parts"] as const,
  incident: (organizationId: string, number: number) =>
    ["organization", organizationId, "incidents", "detail", number] as const,
  memberResponses: (organizationId: string, membershipId: string) =>
    [
      "organization",
      organizationId,
      "incidents",
      "member-responses",
      membershipId,
    ] as const,
  notifications: (organizationId: string) =>
    ["organization", organizationId, "notifications"] as const,
  unreadNotificationCount: (organizationId: string) =>
    ["organization", organizationId, "notifications", "unread-count"] as const,
  notificationList: (organizationId: string) =>
    ["organization", organizationId, "notifications", "list"] as const,
  /** Under the incidents, so any change to them refreshes it too. */
  incidentRepeats: (organizationId: string, number: number) =>
    ["organization", organizationId, "incidents", "repeats", number] as const,
  incidentTimeline: (organizationId: string, number: number) =>
    [
      "organization",
      organizationId,
      "incidents",
      "detail",
      number,
      "timeline",
    ] as const,
  incidentAnalysis: (organizationId: string, number: number) =>
    [
      "organization",
      organizationId,
      "incidents",
      "detail",
      number,
      "analysis",
    ] as const,
};
