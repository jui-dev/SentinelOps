import {
  CircleCheck,
  Compass,
  FilePenLine,
  Megaphone,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { organizationPath } from "@/components/app/navigation";
import type { SectionFamily } from "@/components/overview/overview-panel";
import { Permission } from "@/lib/api/contracts";
import type { IncidentStatus, Role } from "@/lib/api/contracts";

/**
 * What the How it works page says: the steps an incident goes through, who
 * does what at each, and where in SentinelOps it is done.
 *
 * Written to match what the API allows — role-permissions.ts is the rule,
 * and every action is checked there. These words explain it; they grant
 * nothing. A link is offered only to whoever holds its permission.
 */

/** The roles, in the order an incident needs them, the Admin behind them all. */
export const ROLES_IN_ORDER: readonly Role[] = [
  "REPORTER",
  "INCIDENT_MANAGER",
  "RESPONDER",
  "ADMIN",
];

const EVERYONE: readonly Role[] = ROLES_IN_ORDER;

/** A page a step is done on, for whoever may open it. */
export interface StepLink {
  label: string;
  href: (orgSlug: string) => string;
  /** The permission that opens it, as the navigation requires. */
  requires: string;
  /** Who holds it: said in place of the link to everyone else. */
  roles: readonly Role[];
}

/** How a role takes part in a step. */
export type Part = "lead" | "help" | "none";

export interface Step {
  id: string;
  number: string;
  name: string;
  /** One line: what the step is for. */
  summary: string;
  /** Its few words on the journey's overview. */
  short: string;
  icon: LucideIcon;
  family: SectionFamily;
  /** Where the incident stands during the step, if it has begun. */
  status?: IncidentStatus;
  actions: { title: string; text: string }[];
  who: Record<Role, { part: Part; text: string }>;
  links: StepLink[];
}

const path = (to: string) => (slug: string) => `${organizationPath(slug)}${to}`;

export const STEPS: readonly Step[] = [
  {
    id: "set-up",
    number: "00",
    name: "Set up",
    short: "Before anything goes wrong.",
    summary:
      "Before anything goes wrong: the people, the teams, and what each team looks after.",
    icon: ShieldCheck,
    family: "setup",
    actions: [
      {
        title: "Add people and give each a role",
        text: "Each person signs in first with a one-time password, then sets their own.",
      },
      {
        title: "Put people on teams",
        text: "A team decides which incidents someone sees and can respond to.",
      },
      {
        title: "Add services and their owner team",
        text: "An incident is declared against a service; its owner team responds to it.",
      },
      {
        title: "Keep known issues",
        text: "Problems that come back, so they can be chosen when declaring next time.",
      },
    ],
    who: {
      REPORTER: { part: "none", text: "Sees their own teams" },
      INCIDENT_MANAGER: { part: "none", text: "Reads every team and member" },
      RESPONDER: { part: "none", text: "Sees their own teams" },
      ADMIN: { part: "lead", text: "Does all of it" },
    },
    links: [
      {
        label: "Members",
        href: path("/members"),
        requires: Permission.MEMBERSHIPS_READ_ALL,
        roles: ["INCIDENT_MANAGER", "ADMIN"],
      },
      { label: "Teams", href: path("/teams"), requires: Permission.TEAMS_READ, roles: EVERYONE },
      {
        label: "Services",
        href: path("/services"),
        requires: Permission.SERVICES_READ,
        roles: EVERYONE,
      },
      {
        label: "Known issues",
        href: path("/known-issues"),
        requires: Permission.SERVICES_MANAGE,
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "report",
    number: "01",
    name: "Report",
    short: "Something is wrong.",
    summary: "Something is wrong: declare it, so the right team hears about it at once.",
    icon: Megaphone,
    family: "operations",
    status: "DECLARED",
    actions: [
      {
        title: "Declare an incident",
        text: "A title, what is happening, the service affected — and, if it has happened before, its known issue.",
      },
      {
        title: "Suggest a severity",
        text: "SEV1 critical to SEV4 minor. A Reporter’s is a suggestion until someone confirms it.",
      },
    ],
    who: {
      REPORTER: { part: "lead", text: "Declares, and suggests a severity" },
      INCIDENT_MANAGER: { part: "help", text: "Declares too" },
      RESPONDER: { part: "none", text: "Hears of it when it is theirs" },
      ADMIN: { part: "help", text: "Declares too" },
    },
    links: [
      {
        label: "Incidents · Declare incident",
        href: path("/incidents"),
        requires: Permission.INCIDENTS_DECLARE,
        roles: ["REPORTER", "INCIDENT_MANAGER", "ADMIN"],
      },
    ],
  },
  {
    id: "decide",
    number: "02",
    name: "Decide",
    short: "Someone takes charge.",
    summary: "Someone takes charge: how serious it is, and who works on it.",
    icon: Compass,
    family: "decision",
    status: "DECLARED",
    actions: [
      { title: "Confirm the severity", text: "Keep the suggestion, or change it." },
      {
        title: "Choose who responds",
        text: "Open to team — anyone on it can start — or assign named people.",
      },
    ],
    who: {
      REPORTER: { part: "none", text: "Not part of this step" },
      INCIDENT_MANAGER: { part: "lead", text: "Confirms severity, chooses who responds" },
      RESPONDER: { part: "none", text: "Is told when it is theirs" },
      ADMIN: { part: "help", text: "Steps in when no one else is around" },
    },
    links: [
      {
        label: "Overview · Waiting on you",
        href: path(""),
        requires: Permission.INCIDENTS_MANAGE,
        roles: ["INCIDENT_MANAGER", "ADMIN"],
      },
    ],
  },
  {
    id: "respond",
    number: "03",
    name: "Respond",
    short: "The team works it.",
    summary:
      "The team works it: each responder starts, keeps everyone posted, and says when their part is done.",
    icon: Wrench,
    family: "investigating",
    status: "INVESTIGATING",
    actions: [
      {
        title: "Start investigating",
        text: "The first start moves the incident to Investigating.",
      },
      {
        title: "Post updates",
        text: "What was found, what was tried, what customers are told — on the incident’s timeline.",
      },
      {
        title: "Mark your part complete",
        text: "When there is nothing left for you to do on it.",
      },
    ],
    who: {
      REPORTER: { part: "help", text: "Follows what they reported, posts updates" },
      INCIDENT_MANAGER: { part: "help", text: "Changes the team, posts updates" },
      RESPONDER: { part: "lead", text: "Starts, posts updates, completes" },
      ADMIN: { part: "help", text: "Follows, posts updates" },
    },
    links: [
      {
        label: "My Operations",
        href: path(""),
        requires: Permission.RESPONSES_WORK,
        roles: ["RESPONDER"],
      },
      {
        label: "Incidents",
        href: path("/incidents"),
        requires: Permission.INCIDENTS_READ,
        roles: EVERYONE,
      },
    ],
  },
  {
    id: "resolve",
    number: "04",
    name: "Resolve",
    short: "Closed, with a note.",
    summary: "Once everyone who started has finished, it is closed with a note on how.",
    icon: CircleCheck,
    family: "resolved",
    status: "RESOLVED",
    actions: [
      {
        title: "Resolve the incident",
        text: "It opens when every responder who started has completed.",
      },
      {
        title: "Write the resolution note",
        text: "How it was fixed. A resolved incident is kept as it is — if it returns, declare a new one.",
      },
    ],
    who: {
      REPORTER: { part: "none", text: "Not part of this step" },
      INCIDENT_MANAGER: { part: "lead", text: "Resolves, with a note" },
      RESPONDER: { part: "none", text: "Their completing opens it" },
      ADMIN: { part: "help", text: "Resolves too" },
    },
    links: [
      {
        label: "Overview · Ready to resolve",
        href: path(""),
        requires: Permission.INCIDENTS_MANAGE,
        roles: ["INCIDENT_MANAGER", "ADMIN"],
      },
      {
        label: "Incident history",
        href: path("/incidents/history"),
        requires: Permission.INCIDENTS_READ_ALL,
        roles: ["INCIDENT_MANAGER", "ADMIN"],
      },
    ],
  },
  {
    id: "learn",
    number: "05",
    name: "Learn",
    short: "While it is fresh.",
    summary: "While it is fresh: what happened, what it hit, why, and what to change.",
    icon: FilePenLine,
    family: "trend",
    status: "RESOLVED",
    actions: [
      {
        title: "Start the analysis, and pick who writes it",
        text: "SentinelOps brings in the incident’s facts and key moments.",
      },
      {
        title: "Write it, section by section",
        text: "Summary — needed to publish — then Impact, Cause and Lessons; each marked done.",
      },
      {
        title: "Publish it",
        text: "Everyone who can see the incident can read it — and next time, it is there to learn from.",
      },
    ],
    who: {
      REPORTER: { part: "none", text: "Reads it once published" },
      INCIDENT_MANAGER: { part: "lead", text: "Starts it, picks who writes" },
      RESPONDER: { part: "help", text: "Writes the analyses they own" },
      ADMIN: { part: "help", text: "Starts it, picks who writes" },
    },
    links: [
      {
        label: "A resolved incident · Start analysis",
        href: path("/incidents?view=resolved"),
        requires: Permission.INCIDENTS_MANAGE,
        roles: ["INCIDENT_MANAGER", "ADMIN"],
      },
    ],
  },
];

/** Everything each role can do, grouped: the page's map. */
export const ABILITIES: readonly {
  group: string;
  items: readonly { what: string; roles: readonly Role[] }[];
}[] = [
  {
    group: "Setting up",
    items: [
      { what: "Add people, give and change roles", roles: ["ADMIN"] },
      { what: "Create teams, place people on them", roles: ["ADMIN"] },
      { what: "Add and edit services", roles: ["ADMIN"] },
      { what: "Keep known issues", roles: ["ADMIN"] },
      { what: "Read the activity log", roles: ["ADMIN"] },
    ],
  },
  {
    group: "An incident",
    items: [
      { what: "Declare an incident", roles: ["REPORTER", "INCIDENT_MANAGER", "ADMIN"] },
      { what: "Confirm severity, choose who responds", roles: ["INCIDENT_MANAGER", "ADMIN"] },
      { what: "Start and complete a response", roles: ["RESPONDER"] },
      { what: "Post updates on an incident", roles: EVERYONE },
      { what: "Resolve an incident", roles: ["INCIDENT_MANAGER", "ADMIN"] },
    ],
  },
  {
    group: "Learning from it",
    items: [
      { what: "Start an analysis, pick who writes it", roles: ["INCIDENT_MANAGER", "ADMIN"] },
      { what: "Write an analysis", roles: ["RESPONDER", "INCIDENT_MANAGER", "ADMIN"] },
      { what: "Read published analyses", roles: EVERYONE },
    ],
  },
  {
    group: "Seeing",
    items: [
      { what: "See every incident", roles: ["INCIDENT_MANAGER", "ADMIN"] },
      { what: "See your teams’ incidents", roles: EVERYONE },
      { what: "See every member", roles: ["INCIDENT_MANAGER", "ADMIN"] },
    ],
  },
];

/** Where things show up while an incident runs, and after. */
export const WHERE_IT_SHOWS: readonly {
  title: string;
  text: string;
  link?: StepLink;
}[] = [
  {
    title: "Your home page",
    text: "What is wrong now, and what is waiting on you — the first page after signing in.",
    link: { label: "Open", href: path(""), requires: Permission.ORGANIZATION_READ, roles: EVERYONE },
  },
  {
    title: "Notifications",
    text: "Told as it happens: assigned to you, ready to resolve, an analysis to write. The bell in the top bar.",
  },
  {
    title: "Incident history",
    text: "Every incident in a period you choose, and how long each lasted.",
    link: {
      label: "Open",
      href: path("/incidents/history"),
      requires: Permission.INCIDENTS_READ_ALL,
      roles: ["INCIDENT_MANAGER", "ADMIN"],
    },
  },
  {
    title: "Activity log",
    text: "Every change to the organization’s setup, and every sign-in.",
    link: {
      label: "Open",
      href: path("/activity"),
      requires: Permission.ACTIVITY_READ,
      roles: ["ADMIN"],
    },
  },
];
