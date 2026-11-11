import {
  BookMarked,
  Boxes,
  History,
  LayoutPanelTop,
  Network,
  Settings2,
  Siren,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Permission } from "@/lib/api/contracts";

/**
 * The navigation rail, as data.
 *
 * Only what exists is listed. On-call and Activity are not here — not even
 * disabled — because neither exists; each joins the Response section when
 * its routes ship.
 */
export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The item's path within the organization with this slug. */
  href: (slug: string) => string;
  /** `exact` for an index page; `prefix` when sub-pages belong to the item. */
  match: "exact" | "prefix";
  /**
   * Offered only when the API reports this permission. Advice, like
   * `useCan`: the API authorizes the pages behind every item regardless.
   */
  requires?: string;
  /**
   * What the item is called for a caller without a permission, where the
   * page behind it answers them differently: the organization's home is the
   * Overview to whoever oversees every incident, and My Operations to
   * everyone else (see organization-landing.tsx).
   */
  labelWithout?: { permission: string; label: string };
  /** Drawn indented beneath the item before it, which it belongs to. */
  nested?: boolean;
}

/** The item's name for a caller with these permissions. */
export const navItemLabel = (
  item: NavItem,
  permissions: readonly string[],
): string =>
  item.labelWithout && !permissions.includes(item.labelWithout.permission)
    ? item.labelWithout.label
    : item.label;

export interface NavSection {
  id: string;
  /** A heading for the group; omitted for a lone utility group. */
  label?: string;
  /** `main` fills the rail from the top; `footer` sits at its foot. */
  placement: "main" | "footer";
  items: NavItem[];
}

export const organizationPath = (slug: string) =>
  `/orgs/${encodeURIComponent(slug)}`;

/**
 * Home first, then how the organization is set up, then the work it does.
 *
 * Organization lists its pages in the order an organization is built:
 * teams first, because every service needs an owner team; then the members
 * placed on them; then the services those teams own. Response follows,
 * because incidents are declared against those services.
 */
export const ORGANIZATION_NAVIGATION: NavSection[] = [
  {
    id: "home",
    placement: "main",
    items: [
      {
        id: "overview",
        label: "Overview",
        icon: LayoutPanelTop,
        href: organizationPath,
        match: "exact",
        labelWithout: {
          permission: Permission.INCIDENTS_READ_ALL,
          label: "My Operations",
        },
      },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    placement: "main",
    items: [
      {
        id: "teams",
        label: "Teams",
        icon: Network,
        href: (slug) => `${organizationPath(slug)}/teams`,
        match: "prefix",
        requires: Permission.TEAMS_READ,
      },
      {
        id: "members",
        label: "Members",
        icon: Users,
        href: (slug) => `${organizationPath(slug)}/members`,
        match: "prefix",
        // The whole organization's people, for whoever oversees them. A
        // member finds their teammates on each of their teams' pages.
        requires: Permission.MEMBERSHIPS_READ_ALL,
      },
      {
        id: "services",
        label: "Services",
        icon: Boxes,
        href: (slug) => `${organizationPath(slug)}/services`,
        match: "prefix",
        requires: Permission.SERVICES_READ,
      },
      {
        id: "known-issues",
        label: "Known issues",
        icon: BookMarked,
        href: (slug) => `${organizationPath(slug)}/known-issues`,
        match: "prefix",
        // Kept by the Admin; declaring offers them to whoever declares.
        requires: Permission.SERVICES_MANAGE,
        nested: true,
      },
    ],
  },
  {
    id: "response",
    label: "Response",
    placement: "main",
    // On-call and Activity join this section as each ships.
    items: [
      {
        id: "incidents",
        label: "Incidents",
        icon: Siren,
        href: (slug) => `${organizationPath(slug)}/incidents`,
        match: "prefix",
        requires: Permission.INCIDENTS_READ,
      },
      {
        id: "history",
        label: "Incident history",
        icon: History,
        href: (slug) => `${organizationPath(slug)}/incidents/history`,
        match: "prefix",
        // One reading of the whole organization, as the page itself requires.
        requires: Permission.INCIDENTS_READ_ALL,
      },
    ],
  },
  {
    id: "administration",
    placement: "footer",
    items: [
      {
        id: "settings",
        label: "Settings",
        icon: Settings2,
        href: (slug) => `${organizationPath(slug)}/settings`,
        match: "prefix",
        requires: Permission.ORGANIZATION_UPDATE,
      },
    ],
  },
];

/** Whether `pathname` is the item's page (or, for `prefix`, beneath it). */
export const isCurrentPath = (
  href: string,
  match: NavItem["match"],
  pathname: string,
): boolean =>
  pathname === href || (match === "prefix" && pathname.startsWith(`${href}/`));

/**
 * The one item the rail marks current: of the items offered, the most
 * specific one whose page `pathname` is or lies beneath.
 *
 * Items can nest — Incident history lives beneath Incidents — so matching
 * each item on its own would mark both. The longest matching href wins, and
 * only among the items offered: without Incident history, its page still
 * belongs to Incidents.
 */
export const currentNavItemId = (
  sections: NavSection[],
  slug: string,
  permissions: readonly string[],
  pathname: string,
): string | undefined => {
  let best: { id: string; length: number } | undefined;

  for (const section of sections) {
    for (const item of section.items) {
      if (item.requires && !permissions.includes(item.requires)) continue;

      const href = item.href(slug);

      if (
        isCurrentPath(href, item.match, pathname) &&
        (!best || href.length > best.length)
      ) {
        best = { id: item.id, length: href.length };
      }
    }
  }

  return best?.id;
};
