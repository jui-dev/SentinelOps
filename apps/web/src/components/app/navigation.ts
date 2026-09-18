import {
  Boxes,
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
 * disabled — because neither exists; each joins the Operations section when
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
}

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

export const ORGANIZATION_NAVIGATION: NavSection[] = [
  {
    id: "organization",
    label: "Organization",
    placement: "main",
    items: [
      {
        id: "overview",
        label: "Overview",
        icon: LayoutPanelTop,
        href: organizationPath,
        match: "exact",
      },
      {
        id: "members",
        label: "Members",
        icon: Users,
        href: (slug) => `${organizationPath(slug)}/members`,
        match: "prefix",
      },
      {
        id: "teams",
        label: "Teams",
        icon: Network,
        href: (slug) => `${organizationPath(slug)}/teams`,
        match: "prefix",
        requires: Permission.TEAMS_READ,
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
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
        id: "services",
        label: "Services",
        icon: Boxes,
        href: (slug) => `${organizationPath(slug)}/services`,
        match: "prefix",
        requires: Permission.SERVICES_READ,
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
