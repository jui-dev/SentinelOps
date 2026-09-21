"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, BellDot } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useId, useState } from "react";

import { stripIconButtonClasses } from "@/components/app/strip-button";
import {
  organizationQuery,
  useRouteMembership,
} from "@/components/organizations/organization-scope";
import { cx } from "@/components/ui/cx";
import { Popover } from "@/components/ui/popover";
import { Permission } from "@/lib/api/contracts";

import { useUnreadNotificationCount } from "./notification-queries";
import { NotificationsPanel } from "./notifications-panel";

/**
 * The bell in the situation strip: whether anything is unread, and the
 * notifications themselves, one press away.
 *
 * Something unread is meant to be seen: the bell turns golden and carries a
 * red dot in its own outline — a change of shape as well as colour, so it
 * does not depend on colour alone — and no number. With nothing unread it
 * is the strip's quiet grey, so the colour keeps meaning something. The
 * exact count is in its name, and in the panel.
 *
 * It belongs to the organization the page is in: its count is that
 * organization's alone, and it polls — the one thing that does — while the
 * tab is visible. Outside an organization there is nothing to show, and it
 * says so. While the count is loading or has failed it shows no dot: the
 * panel says what went wrong, the strip does not.
 *
 * The panel closes when the page changes, so it never outlives the
 * organization it was opened in.
 */
export function NotificationsBell() {
  const membership = useRouteMembership();
  const pathname = usePathname();
  const organizationId = membership?.organization.id ?? "";
  // The same query, by key, as the organization scope: no second request.
  // Permissions come only from it.
  const detail = useQuery({
    ...organizationQuery(organizationId),
    enabled: membership !== undefined,
  });
  const canRead =
    detail.data?.membership.permissions.includes(
      Permission.NOTIFICATIONS_READ,
    ) ?? false;
  const count = useUnreadNotificationCount(organizationId, {
    enabled: canRead,
    poll: true,
  });
  // Open on the page it was opened on; any other page closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const titleId = useId();

  const setOpen = useCallback(
    (next: boolean) => setOpenOn(next ? pathname : null),
    [pathname],
  );
  const close = useCallback(() => setOpenOn(null), []);

  if (!membership || !canRead) {
    const reason = membership
      ? "Notifications"
      : "Open an organization to see its notifications";

    return (
      <button
        type="button"
        aria-disabled="true"
        title={reason}
        className={cx(stripIconButtonClasses, "cursor-default")}
      >
        <Bell aria-hidden="true" strokeWidth={1.75} className="size-4" />
        <span className="sr-only">{reason}</span>
      </button>
    );
  }

  const unread = count.data?.count ?? 0;
  const name =
    unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  const tooltip =
    unread > 0
      ? `${unread} unread notification${unread === 1 ? "" : "s"}`
      : "No unread notifications";

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      labelledBy={titleId}
      className="fixed inset-x-2 top-[calc(var(--spacing-strip)+0.25rem)] max-h-[calc(100dvh-var(--spacing-strip)-1rem)] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-1.5 sm:max-h-[min(36rem,calc(100dvh-var(--spacing-strip)-1rem))] sm:w-[26rem]"
      trigger={(props) => (
        <button
          type="button"
          title={tooltip}
          className={stripIconButtonClasses}
          {...props}
        >
          {unread > 0 ? (
            <BellDot
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-4 text-ink-signal-caution [&>circle]:fill-ink-signal-critical [&>circle]:stroke-ink-signal-critical"
            />
          ) : (
            <Bell aria-hidden="true" strokeWidth={1.75} className="size-4" />
          )}
          <span className="sr-only">{name}</span>
        </button>
      )}
    >
      <NotificationsPanel
        organizationId={organizationId}
        orgSlug={membership.organization.slug}
        titleId={titleId}
        onClose={close}
      />
    </Popover>
  );
}
