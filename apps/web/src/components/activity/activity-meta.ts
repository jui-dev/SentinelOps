import {
  BookMarked,
  Boxes,
  Building2,
  Network,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { organizationPath } from "@/components/app/navigation";
import { SEVERITY_LEVELS } from "@/components/incidents/severity";
import { memberHref, membersHref } from "@/components/organizations/member-paths";
import { roleMeta } from "@/components/roles/role-meta";
import { criticalityOf } from "@/components/services/criticality";
import { serviceHref } from "@/components/services/service-scope";
import { teamHref } from "@/components/teams/team-scope";
import type { StatusTone } from "@/components/ui/status";
import type {
  ActivityAction,
  ActivityArea,
  ActivityClient,
  ActivityChange,
  ActivityEntryDetailResponse,
  ActivityEntryResponse,
  ChangeArea,
  SecurityAction,
  ServiceCriticality,
} from "@/lib/api/contracts";

/**
 * How the activity log reads: each area's name, icon and colour, and each
 * entry as a sentence a person would say — never an event name.
 */

export const CHANGE_AREAS: readonly ChangeArea[] = [
  "PEOPLE",
  "TEAMS",
  "SERVICES",
  "KNOWN_ISSUES",
  "ORGANIZATION",
];

export const AREA_META: Record<
  ActivityArea,
  { label: string; icon: LucideIcon; text: string; swatch: string }
> = {
  PEOPLE: {
    label: "People",
    icon: Users,
    text: "text-area-people",
    swatch: "bg-area-people",
  },
  TEAMS: {
    label: "Teams",
    icon: Network,
    text: "text-area-teams",
    swatch: "bg-area-teams",
  },
  SERVICES: {
    label: "Services",
    icon: Boxes,
    text: "text-area-services",
    swatch: "bg-area-services",
  },
  KNOWN_ISSUES: {
    label: "Known issues",
    icon: BookMarked,
    text: "text-area-known-issues",
    swatch: "bg-area-known-issues",
  },
  ORGANIZATION: {
    label: "Organization",
    icon: Building2,
    text: "text-area-organization",
    swatch: "bg-area-organization",
  },
  SECURITY: {
    label: "Security",
    icon: ShieldCheck,
    text: "text-fg-muted",
    swatch: "bg-fg-muted",
  },
};

/**
 * What an entry says happened, in three parts: the words before the name
 * of what it was done to, that name (drawn bold), and any words after.
 */
export interface Sentence {
  before: string;
  target: string | null;
  after?: string;
}

const changeOf = (entry: ActivityEntryResponse, field: string) =>
  entry.changes.find((change) => change.field === field);

export const sentenceOf = (entry: ActivityEntryResponse): Sentence => {
  const target = entry.subject?.name ?? null;
  const member = changeOf(entry, "member");

  const sentences: Record<ActivityAction, Sentence> = {
    MEMBER_ADDED: { before: "Added the member", target },
    ROLE_CHANGED: { before: "Changed the role of", target },
    PASSWORD_RESET: { before: "Reset the password of", target },
    INVITATION_SENT: { before: "Invited", target },
    INVITATION_REVOKED: { before: "Withdrew the invitation for", target },
    INVITATION_ACCEPTED: {
      before: "Joined the organization by accepting an invitation",
      target: null,
    },
    TEAM_CREATED: { before: "Created the team", target },
    TEAM_UPDATED: { before: "Changed the team", target },
    TEAM_DELETED: { before: "Deleted the team", target },
    TEAM_MEMBER_ADDED: {
      before: `Added ${member?.after ?? "someone"} to`,
      target,
    },
    TEAM_MEMBER_REMOVED: {
      before: `Took ${member?.before ?? "someone"} off`,
      target,
    },
    SERVICE_CREATED: { before: "Created the service", target },
    SERVICE_UPDATED: { before: "Changed the service", target },
    SERVICE_DELETED: { before: "Deleted the service", target },
    KNOWN_ISSUE_CREATED: { before: "Added the known issue", target },
    KNOWN_ISSUE_UPDATED: { before: "Changed the known issue", target },
    KNOWN_ISSUE_MERGED: {
      before: "Merged the known issue",
      target,
      after: `into ${changeOf(entry, "mergedInto")?.after ?? "another"}`,
    },
    ORGANIZATION_UPDATED: { before: "Renamed the organization", target: null },
    SIGNED_IN: { before: "Signed in", target: null },
    SIGN_IN_FAILED: { before: "Tried a wrong password", target: null },
    SIGN_IN_BLOCKED: { before: "Sign-ins were blocked", target: null },
    PASSWORD_CHANGED: { before: "Changed their password", target: null },
  };

  return sentences[entry.action];
};

/** The sentence as plain text, for an accessible name or a heading. */
export const sentenceText = (entry: ActivityEntryResponse): string => {
  const { before, target, after } = sentenceOf(entry);

  return [before, target, after].filter(Boolean).join(" ");
};

/** The details window's heading: what kind of thing happened. */
export const ACTION_TITLE: Record<ActivityAction, string> = {
  MEMBER_ADDED: "Member added",
  ROLE_CHANGED: "Role changed",
  PASSWORD_RESET: "Password reset",
  INVITATION_SENT: "Invitation sent",
  INVITATION_REVOKED: "Invitation withdrawn",
  INVITATION_ACCEPTED: "Invitation accepted",
  TEAM_CREATED: "Team created",
  TEAM_UPDATED: "Team changed",
  TEAM_DELETED: "Team deleted",
  TEAM_MEMBER_ADDED: "Added to a team",
  TEAM_MEMBER_REMOVED: "Taken off a team",
  SERVICE_CREATED: "Service created",
  SERVICE_UPDATED: "Service changed",
  SERVICE_DELETED: "Service deleted",
  KNOWN_ISSUE_CREATED: "Known issue added",
  KNOWN_ISSUE_UPDATED: "Known issue changed",
  KNOWN_ISSUE_MERGED: "Known issues merged",
  ORGANIZATION_UPDATED: "Organization renamed",
  SIGNED_IN: "Signed in",
  SIGN_IN_FAILED: "Wrong password",
  SIGN_IN_BLOCKED: "Sign-ins blocked",
  PASSWORD_CHANGED: "Password changed",
};

const FIELD_LABEL: Record<string, string> = {
  role: "Role",
  email: "Email",
  teams: "Teams",
  name: "Name",
  description: "Description",
  team: "Team",
  criticality: "Criticality",
  status: "Status",
  usualSeverity: "Usual severity",
  service: "Service",
  member: "Member",
  mergedInto: "Merged into",
  incidentsMoved: "Incidents moved",
};

/** A field's name for a person: "usualSeverity" reads "Usual severity". */
export const fieldLabel = (field: string): string =>
  FIELD_LABEL[field] ??
  field.replace(/([A-Z])/g, " $1").replace(/^./, (first) => first.toUpperCase());

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  ARCHIVED: "Archived",
  PENDING_REVIEW: "Waiting for review",
};

/**
 * A value as a person reads it: a role by its name, a criticality or a
 * severity by its word. Anything this client does not know is shown as the
 * API wrote it. Null — a side that did not exist — is a dash.
 */
export const formatValue = (field: string, value: string | null): string => {
  if (value === null) return "—";

  switch (field) {
    case "role":
      return roleMeta(value).label;
    case "criticality":
      return criticalityOf(value as ServiceCriticality).label;
    case "usualSeverity": {
      const level = SEVERITY_LEVELS.find((each) => each.value === value);

      return level ? `${level.value} · ${level.label}` : value;
    }
    case "status":
      return STATUS_LABEL[value] ?? value;
    default:
      return value;
  }
};

/**
 * The one change a row shows inline: the first with both a before and an
 * after, and how many more the entry made. A creation has no before, so it
 * shows none — its details say what it was made with.
 */
export const inlineChange = (
  entry: ActivityEntryResponse,
): { change: ActivityChange; more: number } | null => {
  // Who joined or left a team is already in the sentence.
  const shown = entry.changes.filter((change) => change.field !== "member");
  const change = shown.find(
    ({ before, after }) => before !== null && after !== null,
  );

  return change ? { change, more: shown.length - 1 } : null;
};

/** A short line under the sentence, for what a creation was made as. */
export const noteOf = (entry: ActivityEntryResponse): string | null => {
  const role = changeOf(entry, "role");

  switch (entry.action) {
    case "MEMBER_ADDED":
    case "INVITATION_SENT":
    case "INVITATION_ACCEPTED":
      return role?.after ? `As ${article(formatValue("role", role.after))}` : null;
    case "KNOWN_ISSUE_CREATED": {
      const service = changeOf(entry, "service")?.after;
      const pending = changeOf(entry, "status")?.after === "PENDING_REVIEW";

      if (pending) return "Saved while declaring an incident";

      return service ? `On ${service}` : null;
    }
    case "PASSWORD_RESET":
      return "Signed out everywhere";
    default:
      return null;
  }
};

const article = (word: string) =>
  `${/^[AEIOU]/i.test(word) ? "an" : "a"} ${word}`;

/**
 * Where the entry's subject is now, and what to call the link — or why
 * there is nothing to open.
 */
export const subjectLink = (
  orgSlug: string,
  entry: ActivityEntryDetailResponse,
): { href: string; label: string } | { gone: string } | null => {
  const { subject, subjectNow } = entry;

  if (subject === null || subjectNow === null) return null;
  if (!subjectNow.exists) {
    return { gone: `${subject.name} no longer exists, so there's nothing to open.` };
  }

  switch (subject.type) {
    case "MEMBERSHIP":
      return {
        href: memberHref(orgSlug, subject.id),
        label: `Open ${subject.name} in Members`,
      };
    case "INVITATION":
      return { href: membersHref(orgSlug), label: "Open Members" };
    case "TEAM":
      return {
        href: teamHref(orgSlug, subjectNow.slug ?? subject.id),
        label: `Open the ${subject.name} team`,
      };
    case "SERVICE":
      return subjectNow.slug
        ? { href: serviceHref(orgSlug, subjectNow.slug), label: `Open ${subject.name}` }
        : null;
    case "KNOWN_ISSUE":
      return {
        href: `${organizationPath(orgSlug)}/known-issues`,
        label: "Open Known issues",
      };
    case "ORGANIZATION":
      return {
        href: `${organizationPath(orgSlug)}/settings`,
        label: "Open Settings",
      };
  }
};

// ── Sign-ins ───────────────────────────────────────────────────────────────

/** The sign-in results, in the order the Result filter offers them. */
export const SECURITY_RESULTS: readonly {
  value: SecurityAction;
  label: string;
  tone: StatusTone;
}[] = [
  { value: "SIGNED_IN", label: "Signed in", tone: "success" },
  { value: "SIGN_IN_FAILED", label: "Wrong password", tone: "warning" },
  { value: "SIGN_IN_BLOCKED", label: "Blocked", tone: "danger" },
  { value: "PASSWORD_CHANGED", label: "Password changed", tone: "neutral" },
];

/** A sign-in event's result as a status: its word and tone, and how many. */
export const resultOf = (
  entry: ActivityEntryResponse,
): { label: string; tone: StatusTone } => {
  const result =
    SECURITY_RESULTS.find((each) => each.value === entry.action) ??
    SECURITY_RESULTS[0];

  return {
    label: entry.repeat ? `${result.label} ×${entry.repeat.count}` : result.label,
    tone: result.tone,
  };
};

/** A local time of day, "13:24". */
export const clockTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

/** The line under a sign-in event's result, saying what made it notable. */
export const securityNote = (entry: ActivityEntryResponse): string | null => {
  switch (entry.action) {
    case "SIGNED_IN":
      return changeOf(entry, "with")?.after === "ONE_TIME_PASSWORD"
        ? "First sign-in, with a one-time password"
        : null;
    case "SIGN_IN_FAILED":
      return entry.repeat
        ? `${clockTime(entry.repeat.firstAt)} to ${clockTime(entry.occurredAt)}`
        : null;
    case "SIGN_IN_BLOCKED": {
      const until = changeOf(entry, "blockedUntil")?.after;

      return until
        ? `Sign-ins refused until ${clockTime(until)}, after repeated wrong passwords`
        : "Sign-ins refused after repeated wrong passwords";
    }
    case "PASSWORD_CHANGED":
      return changeOf(entry, "replaced")?.after === "ONE_TIME_PASSWORD"
        ? "Replaced the one-time password the Admin gave"
        : null;
    default:
      return null;
  }
};

/** Whether a sign-in came from somewhere the account does not usually use. */
export const isUnusualClient = (
  client: ActivityClient | null,
  usual: ActivityClient | null,
): boolean =>
  client !== null &&
  usual !== null &&
  (client.ipAddress !== usual.ipAddress || client.browser !== usual.browser);

/** An address and browser on one line, "10.0.4.2 · Chrome on Windows". */
export const clientText = (client: ActivityClient | null): string =>
  client
    ? [client.ipAddress, client.browser].filter(Boolean).join(" · ") ||
      "Not known"
    : "Not known";

// ── Time ───────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

/** The periods the log is read over, the first the default. */
export const PERIODS = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "24h", label: "Last 24 hours", days: 1 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "all", label: "All time", days: null },
] as const;

export type PeriodValue = (typeof PERIODS)[number]["value"];

/**
 * The instant a period starts, to the minute — so the query it keys stays
 * the same for a minute, rather than changing on every render.
 */
export const periodStart = (period: PeriodValue, now: number): string | undefined => {
  const days = PERIODS.find((each) => each.value === period)?.days ?? null;

  if (days === null) return undefined;

  const start = now - days * DAY;

  return new Date(start - (start % 60_000)).toISOString();
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** A day heading: "Today · Thursday 12 November", in local time. */
export const dayHeading = (iso: string, now: Date): string => {
  const day = new Date(iso);
  const yesterday = new Date(now.getTime() - DAY);
  const date = day.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });

  if (sameDay(day, now)) return `Today · ${date}`;
  if (sameDay(day, yesterday)) return `Yesterday · ${date}`;

  return date;
};

/** The local calendar day an instant falls on, as a grouping key. */
export const dayKey = (iso: string): string => {
  const day = new Date(iso);

  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
};

/** How long ago, in the largest whole unit: "2 hours ago". */
export const timeAgo = (iso: string, now: number): string => {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const units: [number, string][] = [
    [365 * 86_400, "year"],
    [30 * 86_400, "month"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];

  for (const [size, unit] of units) {
    const count = Math.floor(seconds / size);

    if (count >= 1) return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }

  return "just now";
};
