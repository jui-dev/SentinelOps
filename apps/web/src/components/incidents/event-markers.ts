import {
  ArrowLeftRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Flag,
  Gauge,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The glyph for each kind of recorded event: an icon per kind, so a start, a
 * completion, and a lifecycle change are told apart at a glance. Colour only
 * where it means what it means elsewhere — the lifecycle's: crimson for the
 * declaration, blue for a response under way, teal for a response complete
 * and for the resolution.
 *
 * One vocabulary for everything that draws an incident's events: the
 * timeline, and an analysis's key moments.
 */
export const EVENT_MARKERS = {
  declared: { Icon: Flag, colour: "text-status-declared-text" },
  severityChanged: { Icon: Gauge, colour: "text-fg-muted" },
  teamChanged: { Icon: ArrowLeftRight, colour: "text-fg-muted" },
  responseStarted: {
    Icon: CircleDot,
    colour: "text-status-investigating-text",
  },
  responseCompleted: {
    Icon: CircleCheck,
    colour: "text-status-resolved-text",
  },
  resolved: { Icon: CircleCheck, colour: "text-status-resolved-text" },
  statusChanged: { Icon: CircleDashed, colour: "text-fg-muted" },
} as const satisfies Record<string, { Icon: LucideIcon; colour: string }>;

export type EventMarker = (typeof EVENT_MARKERS)[keyof typeof EVENT_MARKERS];
