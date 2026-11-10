"use client";

import {
  ChevronDown,
  LogOut,
  Monitor,
  Moon,
  Sun,
  User,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";

import { stripIconButtonClasses } from "@/components/app/strip-button";
import { NotificationsBell } from "@/components/notifications/notifications-bell";
import {
  Menu,
  MenuHeading,
  MenuItem,
  MenuItemRadio,
  MenuSection,
  MenuSeparator,
} from "@/components/ui/menu";
import { useMinuteClock } from "@/components/ui/timestamp";
import { useRouteMembership } from "@/components/organizations/organization-scope";
import { formatRole } from "@/components/organizations/format";
import { memberHref } from "@/components/organizations/member-paths";
import { useCurrentUser, useSession } from "@/lib/auth/session-provider";
import { setThemePreference, useThemePreference } from "@/lib/theme/theme";
import type { ThemePreference } from "@/lib/theme/theme";

/**
 * The strip's trailing cluster: the time SentinelOps reads against, then
 * appearance, notifications, and the account. Drawn for the ink strip.
 */

const iconButtonClasses = stripIconButtonClasses;

const pad = (value: number) => String(value).padStart(2, "0");

const UTC_DATE = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const LOCAL_DATE_TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The browser's offset from UTC: "UTC+6", "UTC+5:30", "UTC-3", "UTC". */
export const formatUtcOffset = (date: Date): string => {
  const minutes = -date.getTimezoneOffset();

  if (minutes === 0) return "UTC";

  const sign = minutes > 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;

  return `UTC${sign}${hours}${rest ? `:${pad(rest)}` : ""}`;
};

/**
 * The date and time in UTC, to the minute — the reference every SentinelOps
 * table and chart is read against. The browser's local time is on hover:
 * neither users nor organizations have a time zone of their own. Ticks on
 * the minute boundary, and is not a live region: nobody needs it announced.
 */
export function ShellClock() {
  const now = useMinuteClock();

  return (
    <time
      dateTime={now.toISOString()}
      title={`Local time: ${LOCAL_DATE_TIME.format(now)} (${formatUtcOffset(now)})`}
      className="hidden flex-col items-end sm:flex"
    >
      <span className="text-2xs leading-4 text-ink-muted">
        {UTC_DATE.format(now)}
      </span>
      <span className="numeric text-xs leading-4 whitespace-nowrap">
        <span className="font-medium text-ink-fg">
          {pad(now.getUTCHours())}:{pad(now.getUTCMinutes())}
        </span>
        <span className="text-ink-muted"> · UTC</span>
      </span>
    </time>
  );
}

const APPEARANCES: { value: ThemePreference; label: string; icon: LucideIcon }[] =
  [
    { value: "dark", label: "Dark", icon: Moon },
    { value: "light", label: "Light", icon: Sun },
    { value: "system", label: "System", icon: Monitor },
  ];

/** Dark, light, or the system's — behind one icon showing the current one. */
export function AppearanceMenu() {
  const preference = useThemePreference();
  const current =
    APPEARANCES.find(({ value }) => value === preference) ?? APPEARANCES[0];
  const name = `Appearance: ${current.label}`;

  return (
    <Menu
      label="Appearance"
      trigger={(props) => (
        <button type="button" title={name} className={iconButtonClasses} {...props}>
          <current.icon aria-hidden="true" strokeWidth={1.75} className="size-4" />
          <span className="sr-only">{name}</span>
        </button>
      )}
    >
      <MenuHeading>Appearance</MenuHeading>
      {APPEARANCES.map(({ value, label, icon }) => (
        <MenuItemRadio
          key={value}
          icon={icon}
          checked={value === preference}
          onSelect={() => setThemePreference(value)}
        >
          {label}
        </MenuItemRadio>
      ))}
    </Menu>
  );
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")
  ).toUpperCase();
}

/**
 * Who is signed in, in what capacity here, the way to their own page, and
 * the way out. Their page is their membership's, so it is offered only
 * inside an organization: outside one there is no "you here" to open.
 */
export function AccountMenu() {
  const router = useRouter();
  const { logout } = useSession();
  const me = useCurrentUser();
  const membership = useRouteMembership();
  const user = me.data;

  // RequireSession navigates to /login once the session is gone.
  const onLogout = async () => {
    try {
      await logout();
    } catch {
      // Local state is already cleared; see SessionProvider.logout.
    }
  };

  return (
    <Menu
      label="Account"
      className="w-64"
      trigger={(props) => (
        <button
          type="button"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-1.5 pl-0.5 text-ink-muted transition-colors duration-(--duration-fast) hover:bg-ink-hover hover:text-ink-fg focus-visible:outline-ink-focus aria-expanded:bg-ink-hover aria-expanded:text-ink-fg"
          {...props}
        >
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-sm bg-ink-raised text-2xs font-semibold text-ink-accent"
          >
            {user ? (
              initialsOf(user.name)
            ) : (
              <User strokeWidth={1.75} className="size-3.5" />
            )}
          </span>
          {user && (
            <span
              aria-hidden="true"
              className="hidden max-w-32 truncate text-sm font-medium text-ink-fg lg:inline"
            >
              {user.name.trim().split(/\s+/)[0]}
            </span>
          )}
          <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
          <span className="sr-only">
            {user ? `Account: ${user.name}` : "Account"}
          </span>
        </button>
      )}
    >
      {user && (
        <>
          <MenuSection>
            <p className="truncate text-sm font-medium text-fg">{user.name}</p>
            <p className="truncate text-xs text-fg-subtle" title={user.email}>
              {user.email}
            </p>
            {membership && (
              <p className="mt-1.5 truncate text-xs text-fg-muted">
                {formatRole(membership.role)} · {membership.organization.name}
              </p>
            )}
          </MenuSection>
          <MenuSeparator />
        </>
      )}
      {membership && (
        <MenuItem
          icon={UserRound}
          onSelect={() =>
            router.push(memberHref(membership.organization.slug, membership.id))
          }
        >
          Your profile
        </MenuItem>
      )}
      <MenuItem icon={LogOut} onSelect={() => void onLogout()}>
        Log out
      </MenuItem>
    </Menu>
  );
}

export function ShellUtilities() {
  return (
    <div className="flex items-center gap-3">
      <ShellClock />
      <span aria-hidden="true" className="hidden h-5 w-px bg-ink-line sm:block" />
      <div className="flex items-center gap-0.5">
        <AppearanceMenu />
        <NotificationsBell />
        <AccountMenu />
      </div>
    </div>
  );
}
