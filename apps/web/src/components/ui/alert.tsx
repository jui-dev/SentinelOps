import type { ReactNode } from "react";

import { ApiError, NetworkError } from "@/lib/api/errors";

const tones = {
  error: "border-red-200 bg-red-50 text-red-900",
  info: "border-slate-200 bg-slate-50 text-slate-800",
};

export function Alert({
  tone = "error",
  children,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}
    >
      {children}
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
}: {
  error: unknown;
  /** Overrides the API's message, e.g. with a friendlier one for a known code. */
  message?: string;
}) {
  const text =
    message ??
    (error instanceof ApiError || error instanceof NetworkError
      ? error.message
      : "Something went wrong");

  return (
    <Alert>
      <p>{text}</p>
      {error instanceof ApiError && error.requestId && (
        <p className="mt-1 text-xs opacity-75">
          Request ID: <code>{error.requestId}</code>
        </p>
      )}
    </Alert>
  );
}
