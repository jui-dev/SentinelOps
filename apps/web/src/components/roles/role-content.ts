import { organizationPath } from "@/components/app/navigation";
import type { Role } from "@/lib/api/contracts";

/**
 * What the Roles pages say about each role: where it sits in an incident,
 * what it does at each step, and the detail of its own page.
 *
 * Written to match what the API allows — role-permissions.ts is the rule,
 * and every action is checked there. The words here explain it; they grant
 * nothing.
 */

/** A role's address under /roles. */
export const ROLE_SLUGS: Record<Role, string> = {
  ADMIN: "admin",
  INCIDENT_MANAGER: "incident-manager",
  REPORTER: "reporter",
  RESPONDER: "responder",
};

export const roleFromSlug = (slug: string): Role | undefined =>
  (Object.keys(ROLE_SLUGS) as Role[]).find((role) => ROLE_SLUGS[role] === slug);

export const rolesHref = (orgSlug: string) =>
  `${organizationPath(orgSlug)}/roles`;

export const roleHref = (orgSlug: string, role: Role) =>
  `${rolesHref(orgSlug)}/${ROLE_SLUGS[role]}`;

// ── The steps of an incident ───────────────────────────────────────────────

export type StageId = "report" | "decide" | "respond" | "learn" | "setUp";

export const STAGES: {
  id: StageId;
  number: string;
  name: string;
  description: string;
}[] = [
  { id: "report", number: "01", name: "Report", description: "Raise it" },
  {
    id: "decide",
    number: "02",
    name: "Decide",
    description: "Severity, who responds",
  },
  {
    id: "respond",
    number: "03",
    name: "Respond",
    description: "Work it to resolved",
  },
  { id: "learn", number: "04", name: "Learn", description: "Write the analysis" },
  {
    id: "setUp",
    number: "—",
    name: "Set up",
    description: "People, teams, services",
  },
];

/** What a role does at one step: leads it, helps, or has no part. */
export type StageCell =
  | { kind: "lead"; jobs: string[] }
  | { kind: "can"; jobs: string[] }
  | { kind: "none" };

const lead = (...jobs: string[]): StageCell => ({ kind: "lead", jobs });
const can = (...jobs: string[]): StageCell => ({ kind: "can", jobs });
const none: StageCell = { kind: "none" };

// ── Each role ──────────────────────────────────────────────────────────────

/** The roles in the order an incident needs them, the Admin behind them all. */
export const FLOW_ORDER: readonly Role[] = [
  "REPORTER",
  "INCIDENT_MANAGER",
  "RESPONDER",
  "ADMIN",
];

export interface RoleContent {
  /** Said to someone in the role: "You can …". */
  youCan: string;
  /** Where it sits: "Leads step 02, Decide". */
  place: string;
  /** Step it leads on the overview's step line. */
  step: { number: string; name: string };
  map: Record<StageId, StageCell>;
  /** When, over one incident's life, the role acts. */
  moments: { when: string; title: string; text: string }[];
  /** What it can do, plainly. */
  can: string[];
  /** What it does not do, and whose job that is. */
  elsewhere: { text: string; role: Role }[];
  /** The pages the role works from. */
  where: (orgSlug: string) => { label: string; detail: string; href?: string }[];
  /** What is put in front of them, as it happens. */
  told: { title: string; text: string }[];
}

export const ROLE_CONTENT: Record<Role, RoleContent> = {
  ADMIN: {
    youCan: "set the organization up, and step in to decide on any incident",
    place: "Sets everything up · behind every step",
    step: { number: "Behind every step", name: "Set up" },
    map: {
      report: can("Declares an incident"),
      decide: can("Steps in to decide"),
      respond: can("Resolves an incident"),
      learn: can("Starts an analysis"),
      setUp: lead(
        "Adds people, gives roles",
        "Sets up teams and services",
        "Keeps known issues",
      ),
    },
    moments: [
      {
        when: "Before",
        title: "Sets the organization up",
        text: "People and their roles, teams, and the services each team owns.",
      },
      {
        when: "Before",
        title: "Keeps known issues",
        text: "Problems that come back, so they can be chosen when declaring.",
      },
      {
        when: "Any time",
        title: "Steps in to decide",
        text: "Everything an Incident Manager does, when one isn't around.",
      },
      {
        when: "Any time",
        title: "Changes roles",
        text: "From Members. The organization always keeps one Admin.",
      },
      {
        when: "After",
        title: "Looks across incidents",
        text: "The Overview and Incident history, for the whole organization.",
      },
    ],
    can: [
      "Add people and give each one a role",
      "Set up teams, services and known issues",
      "See every incident, team and member",
      "Declare, decide on and resolve incidents",
      "Start analyses, and write any of them",
      "Change the organization's settings",
    ],
    elsewhere: [{ text: "Start a response", role: "RESPONDER" }],
    where: (slug) => [
      {
        label: "Members",
        detail: "Add people, place them on teams, change roles",
        href: `${organizationPath(slug)}/members`,
      },
      {
        label: "Teams and Services",
        detail: "Who owns what, and its known issues",
        href: `${organizationPath(slug)}/services`,
      },
      {
        label: "Overview",
        detail: "Home: what's waiting on a decision",
        href: organizationPath(slug),
      },
    ],
    told: [
      {
        title: "A new incident needs a decision",
        text: "Shown on the Overview until someone decides.",
      },
      {
        title: "Ready to resolve",
        text: "The last response under way is complete.",
      },
    ],
  },
  INCIDENT_MANAGER: {
    youCan: "decide on every incident, from declared to resolved",
    place: "Decides on incidents · leads step 02, Decide",
    step: { number: "02", name: "Decide" },
    map: {
      report: can("Declares an incident"),
      decide: lead("Confirms severity", "Opens to the team or assigns people"),
      respond: can("Changes the team", "Resolves once every response is done"),
      learn: lead("Starts the analysis", "Picks who writes it"),
      setUp: none,
    },
    moments: [
      {
        when: "Declared",
        title: "Confirms severity",
        text: "Keeps or changes the severity it was declared with.",
      },
      {
        when: "Declared",
        title: "Decides who responds",
        text: "Opens it to the team, or assigns people. Until then it needs a decision.",
      },
      {
        when: "Investigating",
        title: "Adjusts",
        text: "Raises or lowers severity, or hands it to another team.",
      },
      {
        when: "Ready",
        title: "Resolves",
        text: "Once every response is complete, writes the resolution.",
      },
      {
        when: "Resolved",
        title: "Starts the analysis",
        text: "Chooses who writes it, usually a Responder.",
      },
    ],
    can: [
      "See every incident, team and member",
      "Declare an incident",
      "Set severity and decide who responds",
      "Change the team, and resolve",
      "Post updates on any incident",
      "Start analyses, and write any of them",
      "See the Overview and Incident history",
    ],
    elsewhere: [
      { text: "Start a response", role: "RESPONDER" },
      { text: "Add people or change roles", role: "ADMIN" },
      { text: "Teams, services, known issues", role: "ADMIN" },
    ],
    where: (slug) => [
      {
        label: "Overview",
        detail: "Home: what's waiting on a decision",
        href: organizationPath(slug),
      },
      {
        label: "Incidents",
        detail: "Declare, and find what needs a decision",
        href: `${organizationPath(slug)}/incidents`,
      },
      {
        label: "An incident's page",
        detail: "Manage incident, Responders, Resolve",
      },
    ],
    told: [
      {
        title: "A new incident needs a decision",
        text: "Shown on the Overview until someone decides.",
      },
      {
        title: "Ready to resolve",
        text: "The last response under way is complete.",
      },
    ],
  },
  REPORTER: {
    youCan: "declare incidents against any service, and follow what you raised",
    place: "Raises incidents · leads step 01, Report",
    step: { number: "01", name: "Report" },
    map: {
      report: lead("Declares an incident", "Suggests a severity"),
      decide: none,
      respond: can("Follows what they reported", "Posts updates on it"),
      learn: none,
      setUp: none,
    },
    moments: [
      {
        when: "Noticed",
        title: "Declares it",
        text: "Against the service that's affected, from any team.",
      },
      {
        when: "Declared",
        title: "Says how bad it is",
        text: "The severity it's declared with. An Incident Manager confirms it.",
      },
      {
        when: "Investigating",
        title: "Adds what they hear",
        text: "Posts updates, such as who else is affected.",
      },
      {
        when: "Resolved",
        title: "Sees how it ended",
        text: "The resolution, and the analysis once it's published.",
      },
    ],
    can: [
      "Declare incidents against any service",
      "See the incidents they declared",
      "Post updates on them",
    ],
    elsewhere: [
      { text: "Confirm severity, decide who responds", role: "INCIDENT_MANAGER" },
      { text: "Start a response", role: "RESPONDER" },
      { text: "Save a new known issue", role: "ADMIN" },
    ],
    where: (slug) => [
      {
        label: "Incidents",
        detail: "Declare, and follow what you reported",
        href: `${organizationPath(slug)}/incidents`,
      },
      {
        label: "An incident's page",
        detail: "Where it stands, and Post an update",
      },
    ],
    told: [
      {
        title: "Their incidents, as they stand",
        text: "On the Incidents page, with who is responding.",
      },
    ],
  },
  RESPONDER: {
    youCan: "start a response on your teams' incidents, and ones you're assigned",
    place: "Fixes incidents · leads step 03, Respond",
    step: { number: "03", name: "Respond" },
    map: {
      report: none,
      decide: none,
      respond: lead(
        "Starts their response",
        "Posts updates",
        "Marks their part complete",
      ),
      learn: can("Writes the analyses they own"),
      setUp: none,
    },
    moments: [
      {
        when: "Opened",
        title: "Starts their response",
        text: "On their team's incident once it's opened to them, or one they're assigned.",
      },
      {
        when: "Investigating",
        title: "Posts what they find",
        text: "Updates on the timeline while their response is under way.",
      },
      {
        when: "Done",
        title: "Marks their part complete",
        text: "Their own part. Resolving the incident is the Incident Manager's call.",
      },
      {
        when: "Resolved",
        title: "Writes the analysis",
        text: "When they're chosen to own it.",
      },
    ],
    can: [
      "See their teams' incidents, and ones they're assigned",
      "Start and complete their own response",
      "Post updates while they work",
      "Write the analyses they own",
    ],
    elsewhere: [
      { text: "Declare an incident", role: "REPORTER" },
      { text: "Change severity, team or status", role: "INCIDENT_MANAGER" },
      { text: "Change their teams", role: "ADMIN" },
    ],
    where: (slug) => [
      {
        label: "My Operations",
        detail: "Home: what's waiting for you",
        href: organizationPath(slug),
      },
      {
        label: "Incidents",
        detail: "Your teams' incidents",
        href: `${organizationPath(slug)}/incidents`,
      },
      {
        label: "An incident's page",
        detail: "Start investigating, post updates, complete",
      },
    ],
    told: [
      {
        title: "Declared on their team's service",
        text: "And when it's opened to their team.",
      },
      { title: "Assigned to them", text: "They can start right away." },
      {
        title: "Changes to their incidents",
        text: "Severity changed, moved to another team, resolved.",
      },
      {
        title: "Added to or removed from a team",
        text: "Which changes the incidents they work.",
      },
    ],
  },
};
