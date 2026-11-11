import { incidentHref } from "@/components/incidents/incident-queries";
import { incidentKey, SEVERITY_LEVELS } from "@/components/incidents/severity";
import { teamHref } from "@/components/teams/team-scope";
import type {
  IncidentSeverity,
  NotificationResponse,
} from "@/lib/api/contracts";

/**
 * What a notification says, in words: pure, so every type's wording is
 * tested without rendering anything.
 *
 * Only what the API sends is said. `incident` is the incident as it stands
 * now — its current severity and title head the subject line — and `change`
 * is what the notification reports, as it was recorded then. Nothing is
 * reconstructed: a resolution's note is not in a notification, so it is not
 * here either.
 */

/** Which neutral mark a row draws; the row maps these to icons. */
export type NotificationIcon =
  | "declared"
  | "reassigned"
  | "raised"
  | "lowered"
  /** A severity change whose direction this client cannot rank. */
  | "severity"
  | "resolved"
  | "ready"
  | "opened"
  | "assigned"
  | "team-added"
  | "team-removed";

export type NotificationSubject =
  | {
      kind: "incident";
      /** "INC-104". */
      key: string;
      title: string;
      /** The incident's severity now. */
      severity: IncidentSeverity;
      /**
       * The incident has been resolved since — said on every notification
       * about it but the resolution itself, so an old "ready to resolve"
       * reads as done at a glance.
       */
      nowResolved: boolean;
    }
  | { kind: "team"; name: string };

export interface NotificationDescription {
  icon: NotificationIcon;
  /** What happened: "Severity raised". */
  headline: string;
  subject: NotificationSubject;
  /** The rest, as the row shows it: joined with " · ". */
  detail: string[];
  /**
   * The same, as a sentence read aloud: arrows become "to", and the actor
   * is "by" someone. Without read state or time, which the row adds.
   */
  spoken: string;
  /** Where choosing it goes, within the organization it belongs to. */
  href: string;
}

const severityRank = (severity: string): number =>
  SEVERITY_LEVELS.findIndex(({ value }) => value === severity);

/**
 * Raised when it moved to a more severe level — SEV1 is the most severe —
 * lowered when to a less severe one. A value this client does not know
 * cannot be ranked, and is only said to have changed.
 */
const severityDirection = (
  change: NotificationResponse["change"],
): "raised" | "lowered" | undefined => {
  const from = severityRank(change?.from ?? "");
  const to = severityRank(change?.to ?? "");

  if (from < 0 || to < 0 || from === to) return undefined;

  return to < from ? "raised" : "lowered";
};

/** "from → to", or undefined when the change carries neither. */
const movement = (change: NotificationResponse["change"]) =>
  change?.from && change.to ? `${change.from} → ${change.to}` : undefined;

const present = (parts: (string | undefined)[]): string[] =>
  parts.filter((part): part is string => Boolean(part));

/**
 * Describes one notification. `orgSlug` is the organization the page is in
 * — the only one a notification is ever read in — so every link stays
 * inside it.
 */
export const describeNotification = (
  notification: NotificationResponse,
  orgSlug: string,
): NotificationDescription => {
  const { type, actor, incident, change, team } = notification;
  const by = actor.name;

  if (type === "TEAM_MEMBERSHIP_ADDED" || type === "TEAM_MEMBERSHIP_REMOVED") {
    const added = type === "TEAM_MEMBERSHIP_ADDED";
    const headline = added ? "Added to a team" : "Removed from a team";
    // Every team type carries its team; the API guarantees it.
    const { id, name } = team!;

    return {
      icon: added ? "team-added" : "team-removed",
      headline,
      subject: { kind: "team", name },
      detail: [by],
      spoken: `${headline}. ${name}. By ${by}.`,
      href: teamHref(orgSlug, id),
    };
  }

  // Every incident type carries its incident; the API guarantees it.
  const current = incident!;
  const key = incidentKey(current.number);
  const subject: NotificationSubject = {
    kind: "incident",
    key,
    title: current.title,
    severity: current.severity,
    nowResolved:
      current.status === "RESOLVED" && type !== "INCIDENT_RESOLVED",
  };
  const href = incidentHref(orgSlug, current.number);
  const moved = movement(change);
  const spokenMove = moved?.replace(" → ", " to ");
  const about = `${key} ${current.title}${subject.nowResolved ? ", now resolved" : ""}`;

  const describe = (
    icon: NotificationIcon,
    headline: string,
    detail: (string | undefined)[],
    spokenDetail: (string | undefined)[],
  ): NotificationDescription => ({
    icon,
    headline,
    subject,
    detail: present(detail),
    spoken: `${headline}. ${about}. ${present(spokenDetail).join(", ")}.`,
    href,
  });

  switch (type) {
    case "INCIDENT_DECLARED":
      return describe(
        "declared",
        "Incident declared",
        [
          current.service.name,
          change?.to ? `declared as ${change.to}` : undefined,
          by,
        ],
        [
          current.service.name,
          change?.to ? `declared as ${change.to}` : undefined,
          `by ${by}`,
        ],
      );
    case "INCIDENT_REASSIGNED":
      return describe(
        "reassigned",
        "Incident reassigned",
        [moved, by],
        [spokenMove, `by ${by}`],
      );
    case "INCIDENT_SEVERITY_CHANGED": {
      const direction = severityDirection(change);

      return describe(
        direction ?? "severity",
        direction === "lowered"
          ? "Severity lowered"
          : direction === "raised"
            ? "Severity raised"
            : "Severity changed",
        [moved, by],
        [spokenMove, `by ${by}`],
      );
    }
    case "INCIDENT_RESOLVED":
      return describe(
        "resolved",
        "Incident resolved",
        [current.service.name, by],
        [current.service.name, `by ${by}`],
      );
    case "INCIDENT_READY_TO_RESOLVE":
      return describe(
        "ready",
        "Ready to resolve",
        ["All responses complete", `last by ${by}`],
        ["All responses complete", `the last by ${by}`],
      );
    case "INCIDENT_OPENED_TO_TEAM":
      return describe(
        "opened",
        "Open to your team",
        ["You can start responding", by],
        ["You can start responding", `opened by ${by}`],
      );
    case "INCIDENT_ASSIGNED":
      return describe(
        "assigned",
        "Assigned to you",
        ["You can start responding", by],
        ["You can start responding", `assigned by ${by}`],
      );
    case "INCIDENT_SEVERITY_CONFIRMED": {
      // Kept as suggested, or settled at another severity.
      const kept = !change?.from || change.from === change.to;
      const settled = kept
        ? change?.to
          ? `Kept at ${change.to}`
          : undefined
        : moved;

      return describe(
        "severity",
        "Severity confirmed",
        [settled, by],
        [kept ? settled : spokenMove, `by ${by}`],
      );
    }
  }
};

/** Month and day, in UTC like every date SentinelOps shows at a glance. */
const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * How long ago, as a row's corner shows it: "now", "18m", "2h", "3d", then
 * the date — "Sep 18", with the year once it is not this one. Never
 * negative: a clock slightly behind the server's reads as just now.
 */
export const formatSince = (iso: string, now: Date): string => {
  const at = new Date(iso);
  const minutes = Math.floor(Math.max(0, now.getTime() - at.getTime()) / 60_000);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`;

  return at.getUTCFullYear() === now.getUTCFullYear()
    ? MONTH_DAY.format(at)
    : MONTH_DAY_YEAR.format(at);
};

/** The same, read aloud: "18 minutes ago", "just now", "on Sep 18". */
export const speakSince = (iso: string, now: Date): string => {
  const short = formatSince(iso, now);
  const match = /^(\d+)([mhd])$/.exec(short);

  if (short === "now") return "just now";
  if (!match) return `on ${short}`;

  const [, count, unit] = match;
  const word = { m: "minute", h: "hour", d: "day" }[unit as "m" | "h" | "d"];

  return `${count} ${word}${count === "1" ? "" : "s"} ago`;
};
