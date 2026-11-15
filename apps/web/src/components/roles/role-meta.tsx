import { Compass, Megaphone, ShieldCheck, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cx } from "@/components/ui/cx";
import type { Role } from "@/lib/api/contracts";

/**
 * The four roles as people read them: one per person, each named for its
 * job in an incident. What each may actually do is the API's table, and
 * every action is checked there; this is how the roles are told apart and
 * explained, in one place, for every screen that shows a role.
 */

/** The order the roles are listed in: who sets up, decides, raises, works. */
export const ROLE_ORDER: readonly Role[] = [
  "ADMIN",
  "INCIDENT_MANAGER",
  "REPORTER",
  "RESPONDER",
];

/**
 * Something a role lets a person do, said plainly. Compared between two
 * roles, they say what a change of role gives and takes away.
 */
interface Ability {
  id: string;
  /** "Set up people, teams, services and roles": after "can" or "no longer". */
  text: string;
}

const ABILITIES = {
  setUp: { id: "set-up", text: "Set up people, teams, services and roles" },
  decide: {
    id: "decide",
    text: "Decide on incidents: severity, who responds, and resolving",
  },
  seeAll: { id: "see-all", text: "See every incident and team" },
  declare: { id: "declare", text: "Declare incidents" },
  respond: {
    id: "respond",
    text: "Start responses on their teams' incidents, or ones they're assigned",
  },
  followOwn: { id: "follow-own", text: "Follow the incidents they declared" },
} satisfies Record<string, Ability>;

export interface RoleMeta {
  role: Role;
  label: string;
  /** The role's group in a list: "Incident Managers". */
  plural: string;
  /** Its job in a few words: "Decides on incidents". */
  tagline: string;
  /** One sentence on what the role is for. */
  purpose: string;
  icon: LucideIcon;
  abilities: Ability[];
  /**
   * Its colour, as classes: text, tint, edge, and `wash` — the tint as a
   * gradient's start, for a role's header.
   */
  tone: {
    text: string;
    subtle: string;
    line: string;
    wash: string;
    /** Its page's header: the role's wash, and its edge in dark. */
    hero: string;
    /** That edge alone: none in light, the role's line in dark. */
    heroLine: string;
    /** A filled mark in its colour: the switcher's dot. */
    dot: string;
    /** A count on its colour: the switcher's current tab. */
    solid: string;
    /** The current tab's underline in its colour. */
    underline: string;
  };
}

export const ROLE_META: Record<Role, RoleMeta> = {
  ADMIN: {
    role: "ADMIN",
    label: "Admin",
    plural: "Admins",
    tagline: "Runs the organization",
    purpose:
      "Sets the organization up so incidents land with the right people, and can step in to decide.",
    icon: ShieldCheck,
    abilities: [
      ABILITIES.setUp,
      ABILITIES.decide,
      ABILITIES.seeAll,
      ABILITIES.declare,
    ],
    tone: {
      text: "text-role-admin-text",
      subtle: "bg-role-admin-subtle",
      line: "border-role-admin-line",
      wash: "from-role-admin-subtle",
      hero: "bg-linear-to-br from-role-admin-wash-from to-role-admin-wash-to border-role-admin-hero-line",
      heroLine: "border-role-admin-hero-line",
      dot: "bg-role-admin-text",
      solid: "bg-role-admin-text text-canvas",
      underline: "shadow-[inset_0_-2px_0_var(--color-role-admin-text)]",
    },
  },
  INCIDENT_MANAGER: {
    role: "INCIDENT_MANAGER",
    label: "Incident Manager",
    plural: "Incident Managers",
    tagline: "Decides on incidents",
    purpose:
      "Owns every incident from declared to resolved, so Responders can focus on the fix.",
    icon: Compass,
    abilities: [ABILITIES.decide, ABILITIES.seeAll, ABILITIES.declare],
    tone: {
      text: "text-role-manager-text",
      subtle: "bg-role-manager-subtle",
      line: "border-role-manager-line",
      wash: "from-role-manager-subtle",
      hero: "bg-linear-to-br from-role-manager-wash-from to-role-manager-wash-to border-role-manager-hero-line",
      heroLine: "border-role-manager-hero-line",
      dot: "bg-role-manager-text",
      solid: "bg-role-manager-text text-canvas",
      underline: "shadow-[inset_0_-2px_0_var(--color-role-manager-text)]",
    },
  },
  REPORTER: {
    role: "REPORTER",
    label: "Reporter",
    plural: "Reporters",
    tagline: "Raises incidents",
    purpose:
      "Notices something is wrong and declares it, so the right people hear about it fast.",
    icon: Megaphone,
    abilities: [ABILITIES.declare, ABILITIES.followOwn],
    tone: {
      text: "text-role-reporter-text",
      subtle: "bg-role-reporter-subtle",
      line: "border-role-reporter-line",
      wash: "from-role-reporter-subtle",
      hero: "bg-linear-to-br from-role-reporter-wash-from to-role-reporter-wash-to border-role-reporter-hero-line",
      heroLine: "border-role-reporter-hero-line",
      dot: "bg-role-reporter-text",
      solid: "bg-role-reporter-text text-canvas",
      underline: "shadow-[inset_0_-2px_0_var(--color-role-reporter-text)]",
    },
  },
  RESPONDER: {
    role: "RESPONDER",
    label: "Responder",
    plural: "Responders",
    tagline: "Fixes incidents",
    purpose:
      "Works the incidents their teams are responsible for, or that they're assigned to.",
    icon: Wrench,
    abilities: [ABILITIES.respond],
    tone: {
      text: "text-role-responder-text",
      subtle: "bg-role-responder-subtle",
      line: "border-role-responder-line",
      wash: "from-role-responder-subtle",
      hero: "bg-linear-to-br from-role-responder-wash-from to-role-responder-wash-to border-role-responder-hero-line",
      heroLine: "border-role-responder-hero-line",
      dot: "bg-role-responder-text",
      solid: "bg-role-responder-text text-canvas",
      underline: "shadow-[inset_0_-2px_0_var(--color-role-responder-text)]",
    },
  },
};

/** A role's metadata; an unknown role reads as a Responder's. */
export const roleMeta = (role: string): RoleMeta =>
  ROLE_META[role as Role] ?? ROLE_META.RESPONDER;

/** What moving from one role to another gives, and what it takes away. */
export const roleChange = (from: string, to: string) => {
  const before = roleMeta(from).abilities;
  const after = roleMeta(to).abilities;
  const ids = (abilities: Ability[]) => new Set(abilities.map(({ id }) => id));
  const had = ids(before);
  const has = ids(after);

  return {
    gains: after.filter(({ id }) => !had.has(id)).map(({ text }) => text),
    loses: before.filter(({ id }) => !has.has(id)).map(({ text }) => text),
  };
};

/** A role as a chip: its icon and name, in its colour. */
export function RoleBadge({
  role,
  className,
}: {
  role: string;
  className?: string;
}) {
  const meta = roleMeta(role);
  const Icon = meta.icon;

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        meta.tone.text,
        meta.tone.subtle,
        meta.tone.line,
        className,
      )}
    >
      <Icon aria-hidden="true" strokeWidth={2.25} className="size-3.5" />
      {meta.label}
    </span>
  );
}
