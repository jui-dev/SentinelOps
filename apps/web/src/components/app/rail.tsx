"use client";

import { useQuery } from "@tanstack/react-query";
import { Building, LogOut } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  attentionCount,
  useIncidentAttention,
} from "@/components/incidents/incident-queries";
import { cx } from "@/components/ui/cx";
import { SelectControl } from "@/components/ui/select";
import {
  organizationQuery,
  useRouteMembership,
} from "@/components/organizations/organization-scope";
import { formatRole } from "@/components/organizations/format";
import { Permission } from "@/lib/api/contracts";
import type { MembershipResponse } from "@/lib/api/contracts";
import { useCurrentUser, useSession } from "@/lib/auth/session-provider";

import {
  isCurrentPath,
  ORGANIZATION_NAVIGATION,
  organizationPath,
} from "./navigation";
import type { NavSection } from "./navigation";

function RailLink({
  href,
  label,
  icon: Icon,
  current,
  count = 0,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  current: boolean;
  /** How many things behind the item wait on the caller; none shows nothing. */
  count?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        // Items run from the rail's edge: the current one grows out of it.
        "group relative flex h-8 items-center gap-2.5 rounded-r-md pr-2.5 pl-5 text-base transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2",
        current
          ? "bg-nav-selected font-medium text-fg"
          : "text-fg-muted hover:bg-rail-hover hover:text-fg",
      )}
    >
      {/*
       * The current place: an edge, a fill fading from it, and weight —
       * not colour alone.
       */}
      <span
        aria-hidden="true"
        className={cx(
          "absolute inset-y-0 left-0 w-0.5 bg-accent-mark forced-color-adjust-none forced-colors:bg-[Highlight]",
          !current && "hidden",
        )}
      />
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className={cx(
          "size-4 shrink-0",
          current ? "text-accent-text" : "text-fg-subtle group-hover:text-fg-muted",
        )}
      />
      <span className="truncate">{label}</span>
      {count > 0 && (
        <>
          {/* A count, not an alert: the accent's quiet fill, no motion. */}
          <span
            aria-hidden="true"
            className="numeric ml-auto min-w-5 shrink-0 rounded-full bg-accent-subtle px-1.5 text-center text-xs leading-5 font-semibold text-accent-text"
          >
            {count}
          </span>
          <span className="sr-only">
            , {count} {count === 1 ? "needs" : "need"} your attention
          </span>
        </>
      )}
    </Link>
  );
}

function SectionLinks({
  section,
  slug,
  permissions,
  pathname,
  counts,
}: {
  section: NavSection;
  slug: string;
  permissions: string[];
  pathname: string;
  /** A count to show beside an item, by the item's id. */
  counts: Partial<Record<string, number>>;
}) {
  // Unique per instance: the drawer renders a second rail while open.
  const headingId = useId();
  const items = section.items.filter(
    (item) => !item.requires || permissions.includes(item.requires),
  );

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {section.label && (
        <h2 id={headingId} className="label-caps pr-2.5 pb-1.5 pl-5 text-fg-subtle">
          {section.label}
        </h2>
      )}
      <ul
        aria-labelledby={section.label ? headingId : undefined}
        className="flex flex-col gap-0.5"
      >
        {items.map((item) => {
          const href = item.href(slug);

          return (
            <li key={item.id}>
              <RailLink
                href={href}
                label={item.label}
                icon={item.icon}
                current={isCurrentPath(href, item.match, pathname)}
                count={counts[item.id]}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Which organization the workspace is showing, when there is a choice. With
 * one organization there is nothing to switch, and its name is already in
 * the situation strip and the page's eyebrow.
 */
function OrganizationSwitcher({
  memberships,
  current,
}: {
  memberships: MembershipResponse[];
  current?: MembershipResponse;
}) {
  const router = useRouter();

  return (
    <SelectControl
      aria-label="Organization"
      value={current?.organization.slug ?? ""}
      onChange={(event) =>
        router.push(
          event.target.value ? organizationPath(event.target.value) : "/orgs",
        )
      }
      className="font-medium"
    >
      {!current && <option value="">Choose organization…</option>}
      {memberships.map(({ organization }) => (
        <option key={organization.id} value={organization.slug}>
          {organization.name}
        </option>
      ))}
      {current && <option value="">All organizations…</option>}
    </SelectControl>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")
  ).toUpperCase();
}

/** Who is signed in, and in what capacity here. */
function Account({ role }: { role?: string }) {
  const { logout } = useSession();
  const me = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);

  // RequireSession navigates to /login once the session is gone.
  const onLogout = async () => {
    setSigningOut(true);

    try {
      await logout();
    } catch {
      // Local state is already cleared; see SessionProvider.logout.
    }
  };

  return (
    <div className="mt-2 flex items-center gap-2.5 pt-2 pr-3 pb-4 pl-4">
      {me.data && (
        <>
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-md bg-selected text-2xs font-semibold text-accent-text"
          >
            {initialsOf(me.data.name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-sm font-medium text-fg">
              {me.data.name}
            </p>
            <p
              className="truncate text-xs text-fg-subtle"
              title={me.data.email}
            >
              {role ? formatRole(role) : me.data.email}
            </p>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={onLogout}
        disabled={signingOut}
        title="Log out"
        className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors duration-(--duration-fast) hover:bg-rail-hover hover:text-fg disabled:text-fg-disabled"
      >
        <LogOut aria-hidden="true" className="size-4" />
        <span className="sr-only">{signingOut ? "Logging out…" : "Log out"}</span>
      </button>
    </div>
  );
}

/**
 * The persistent navigation rail: the organization, what can be done in it,
 * and who is signed in. Items the caller's permissions do not include are
 * not offered; the API authorizes every page behind them regardless.
 */
export function Rail() {
  const pathname = usePathname();
  const { orgSlug } = useParams<{ orgSlug?: string }>();
  const me = useCurrentUser();
  const membership = useRouteMembership();
  // The same query, by key, that the organization scope makes — no second
  // request. Permissions come only from it: `me` carries roles, not
  // permissions, and the client never maps one to the other.
  const detail = useQuery({
    ...organizationQuery(membership?.organization.id ?? ""),
    enabled: membership !== undefined,
  });
  const permissions = detail.data?.membership.permissions ?? [];
  const slug = membership?.organization.slug;
  // The Overview's own attention query, by key: one cache, and a count
  // beside Incidents from anywhere in the organization. Asked only once the
  // API says the caller reads incidents; loading or failing, it shows none.
  // The rail is mounted throughout the workspace, so it alone polls.
  const attention = useIncidentAttention(membership?.organization.id ?? "", {
    enabled:
      membership !== undefined &&
      permissions.includes(Permission.INCIDENTS_READ),
    poll: true,
  });
  const counts = {
    incidents: attention.data ? attentionCount(attention.data) : 0,
  };

  const sections = (placement: NavSection["placement"]) =>
    slug
      ? ORGANIZATION_NAVIGATION.filter(
          (section) => section.placement === placement,
        ).map((section) => (
          <SectionLinks
            key={section.id}
            section={section}
            slug={slug}
            permissions={permissions}
            pathname={pathname}
            counts={counts}
          />
        ))
      : null;

  return (
    <nav aria-label="Primary" className="flex h-full min-h-0 flex-col bg-rail">
      {me.data && me.data.memberships.length > 1 && (
        <div className="pt-4 pr-3 pl-5">
          <OrganizationSwitcher
            memberships={me.data.memberships}
            current={membership}
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto py-5 pr-3">
        {sections("main")}
        {!orgSlug && (
          <ul className="flex flex-col gap-0.5">
            <li>
              <RailLink
                href="/orgs"
                label="Organizations"
                icon={Building}
                current={pathname === "/orgs"}
              />
            </li>
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-1 pr-3 pb-2">{sections("footer")}</div>
      <Account role={membership?.role} />
    </nav>
  );
}
