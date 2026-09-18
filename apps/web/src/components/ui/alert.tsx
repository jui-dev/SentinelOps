import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { ApiError, NetworkError } from "@/lib/api/errors";

import { cx } from "./cx";

export type AlertTone = "danger" | "warning" | "success" | "info";

/**
 * A rule, a tint, and a glyph — never colour alone. The glyph's shape differs
 * per tone, and the text says what happened.
 */
const tones: Record<
  AlertTone,
  { frame: string; icon: string; Glyph: typeof Info }
> = {
  danger: {
    frame: "border-danger-solid bg-danger-subtle",
    icon: "text-danger-text",
    Glyph: CircleAlert,
  },
  warning: {
    frame: "border-warning-solid bg-warning-subtle",
    icon: "text-warning-text",
    Glyph: TriangleAlert,
  },
  success: {
    frame: "border-success-solid bg-success-subtle",
    icon: "text-success-text",
    Glyph: CircleCheck,
  },
  info: {
    frame: "border-info-solid bg-info-subtle",
    icon: "text-info-text",
    Glyph: Info,
  },
};

/**
 * Feedback about what the user just did. Danger is announced assertively
 * (`role="alert"`); every other tone politely (`role="status"`).
 */
export function Alert({
  tone = "danger",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  /** A short lead line, set above the body. */
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { frame, icon, Glyph } = tones[tone];

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "flex gap-2.5 rounded-r-md border-l-2 px-3 py-2.5 text-sm text-fg",
        frame,
        className,
      )}
    >
      <Glyph aria-hidden="true" className={cx("mt-0.5 size-4 shrink-0", icon)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <p className="font-medium">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * Shows a failed request. Renders the API's own message and, when there is
 * one, the request id — the key support needs to find the server-side record.
 * Never renders anything else from the response.
 */
export function ErrorAlert({
  error,
  message,
  className,
}: {
  error: unknown;
  /** Overrides the API's message, e.g. with a friendlier one for a known code. */
  message?: string;
  className?: string;
}) {
  const text =
    message ??
    (error instanceof ApiError || error instanceof NetworkError
      ? error.message
      : "Something went wrong");

  return (
    <Alert className={className}>
      <p>{text}</p>
      {error instanceof ApiError && error.requestId && (
        // The id wraps as a whole, never mid-way: it is copied, not read.
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-fg-muted">
          Request ID
          <code className="data whitespace-nowrap text-fg select-all">
            {error.requestId}
          </code>
        </p>
      )}
    </Alert>
  );
}
