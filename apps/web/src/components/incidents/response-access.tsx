"use client";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { cx } from "@/components/ui/cx";
import { Permission } from "@/lib/api/contracts";
import type { IncidentResponse } from "@/lib/api/contracts";

export interface ResponseAccessLabel {
  text: string;
  tone: "decision" | "waiting" | "open" | "yours" | "assigned";
}

/**
 * Who may respond to an active incident, in the reader's words. The Admin
 * is told what needs their decision; a member is told it waits on the Admin,
 * or that it is theirs. Pure, so each wording is tested without rendering.
 */
export const responseAccessLabel = (
  incident: Pick<IncidentResponse, "responseAccess" | "assignees">,
  reader: { decides: boolean; membershipId: string },
): ResponseAccessLabel => {
  if (incident.responseAccess === "PENDING") {
    return reader.decides
      ? { text: "Needs a decision", tone: "decision" }
      : { text: "Waiting for the Admin", tone: "waiting" };
  }

  if (incident.responseAccess === "OPEN") {
    return { text: "Open to team", tone: "open" };
  }

  if (
    !reader.decides &&
    incident.assignees.some(({ membershipId }) => membershipId === reader.membershipId)
  ) {
    return { text: "Assigned to you", tone: "yours" };
  }

  const count = incident.assignees.length;

  return {
    text: `Assigned · ${count} ${count === 1 ? "person" : "people"}`,
    tone: "assigned",
  };
};

const TONES: Record<ResponseAccessLabel["tone"], { text: string; dot?: string }> = {
  decision: { text: "font-medium text-warning-text", dot: "bg-warning-text" },
  waiting: { text: "text-fg-subtle" },
  open: { text: "text-fg-muted" },
  yours: { text: "font-medium text-accent-text", dot: "bg-accent-text" },
  assigned: { text: "text-fg-muted" },
};

/** The reader's wording of who may respond, as a list cell shows it. */
export const useResponseAccessLabel = (
  incident: Pick<IncidentResponse, "responseAccess" | "assignees">,
) => {
  const organization = useOrganization();
  const decides = useCan(Permission.INCIDENTS_MANAGE);

  return responseAccessLabel(incident, {
    decides,
    membershipId: organization.membership.id,
  });
};

/**
 * Who may respond, as a list shows it: a short phrase, with a dot only for
 * what asks something of the reader — a decision, or their own assignment.
 */
export function ResponseAccessMark({
  incident,
  className,
}: {
  incident: Pick<IncidentResponse, "responseAccess" | "assignees">;
  className?: string;
}) {
  const label = useResponseAccessLabel(incident);
  const tone = TONES[label.tone];

  return (
    <span className={cx("inline-flex items-center gap-1.5", tone.text, className)}>
      {tone.dot && (
        <span aria-hidden="true" className={cx("size-1.5 shrink-0 rounded-full", tone.dot)} />
      )}
      {label.text}
    </span>
  );
}
