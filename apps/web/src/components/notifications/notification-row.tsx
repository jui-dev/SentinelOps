"use client";

import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CircleCheck,
  Gauge,
  ListChecks,
  Siren,
  UserMinus,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";

import { SeverityMark, StatusMark } from "@/components/incidents/severity";
import { cx } from "@/components/ui/cx";
import type { NotificationResponse } from "@/lib/api/contracts";

import {
  describeNotification,
  formatSince,
  speakSince,
} from "./describe-notification";
import type { NotificationIcon } from "./describe-notification";

/**
 * Neutral marks, one per kind of event. They say what kind of thing
 * happened; they are never coloured by it. The only colour in a row is what
 * SentinelOps already means by colour — an incident's severity — and the
 * unread mark.
 */
const ICONS: Record<NotificationIcon, LucideIcon> = {
  declared: Siren,
  reassigned: ArrowRightLeft,
  raised: ArrowUp,
  lowered: ArrowDown,
  severity: Gauge,
  resolved: CircleCheck,
  ready: ListChecks,
  "team-added": UserPlus,
  "team-removed": UserMinus,
};

const LOCAL_DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * One notification, read top to bottom: what happened, and when; what it
 * happened to — an incident as it stands now, or a team; then what the
 * change recorded, and who made it.
 *
 * The whole row is one link, to where the notification is about, so it
 * behaves as a link does: it opens in a new tab on request. Its name is the
 * notification as a sentence — unread first, when it is — rather than the
 * row's text in reading order, which would break mid-thought at every line.
 */
export function NotificationRow({
  notification,
  orgSlug,
  now,
  onFollow,
}: {
  notification: NotificationResponse;
  orgSlug: string;
  now: Date;
  /** The row was followed — clicked, or opened in a new tab. */
  onFollow: (notification: NotificationResponse, event: MouseEvent) => void;
}) {
  const description = describeNotification(notification, orgSlug);
  const Icon = ICONS[description.icon];
  const unread = notification.readAt === null;
  const { subject } = description;

  return (
    <li>
      <Link
        href={description.href}
        data-notification-row=""
        aria-label={`${unread ? "Unread. " : ""}${description.spoken} ${speakSince(notification.createdAt, now)}.`}
        onClick={(event) => onFollow(notification, event)}
        onAuxClick={(event) => {
          if (event.button === 1) onFollow(notification, event);
        }}
        className="relative flex gap-3 py-3 pr-4 pl-5 transition-colors duration-(--duration-fast) hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        {unread && (
          <span
            aria-hidden="true"
            className="absolute top-[1.1875rem] left-2 size-1.5 rounded-full bg-accent-mark forced-colors:bg-[CanvasText]"
          />
        )}
        <Icon
          aria-hidden="true"
          strokeWidth={1.75}
          className="mt-0.5 size-4 shrink-0 text-fg-subtle"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex items-baseline gap-3">
            <span
              className={cx(
                "min-w-0 flex-1 truncate text-sm",
                unread ? "font-semibold text-fg" : "text-fg-muted",
              )}
            >
              {description.headline}
            </span>
            <time
              dateTime={notification.createdAt}
              title={LOCAL_DATE_TIME.format(new Date(notification.createdAt))}
              className="numeric shrink-0 text-xs text-fg-subtle"
            >
              {formatSince(notification.createdAt, now)}
            </time>
          </p>
          {subject.kind === "incident" ? (
            <p className="flex min-w-0 items-center gap-2 text-sm">
              <SeverityMark severity={subject.severity} className="shrink-0" />
              <span className="data shrink-0 text-fg-muted">{subject.key}</span>
              <span
                className={cx(
                  "min-w-0 truncate",
                  unread ? "text-fg" : "text-fg-muted",
                )}
              >
                {subject.title}
              </span>
              {subject.nowResolved && (
                <StatusMark status="RESOLVED" className="shrink-0" />
              )}
            </p>
          ) : (
            <p
              className={cx(
                "truncate text-sm font-medium",
                unread ? "text-fg" : "text-fg-muted",
              )}
            >
              {subject.name}
            </p>
          )}
          <p className="truncate text-xs text-fg-muted">
            {description.detail.join(" · ")}
          </p>
        </div>
      </Link>
    </li>
  );
}
