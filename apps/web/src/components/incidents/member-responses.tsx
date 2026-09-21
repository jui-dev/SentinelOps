"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { stretchedLinkClasses } from "@/components/ui/table";
import { Duration } from "@/components/ui/timestamp";
import type { MemberResponseResponse } from "@/lib/api/contracts";

import { incidentHref, useMemberResponses } from "./incident-queries";
import { incidentKey, SeverityMark, StatusMark } from "./severity";

/**
 * Where their own part stands, in the words and marks the incident page's
 * responder rows use: a blue dot while investigating, a green check once
 * complete — with how long, not when, so a list reads as work rather than a
 * log.
 */
function OwnPart({ response }: { response: MemberResponseResponse }) {
  if (response.status === "INVESTIGATING") {
    return (
      <span className="inline-flex items-center gap-1.5 text-status-investigating-text">
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-status-investigating-text"
        />
        Investigating for{" "}
        <span className="data">
          <Duration from={response.startedAt} />
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-status-resolved-text">
      <CircleCheck aria-hidden="true" strokeWidth={2} className="size-3.5" />
      Completed after{" "}
      <span className="data">
        <Duration from={response.startedAt} to={response.completedAt} />
      </span>
    </span>
  );
}

/** One response: the incident first, then their part in it. */
function ResponseRow({ response }: { response: MemberResponseResponse }) {
  const organization = useOrganization();
  const { incident } = response;

  return (
    <li className="relative grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 px-3 py-2.5 hover:bg-hover sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:px-4">
      <span className="pt-px text-sm">
        <SeverityMark severity={incident.severity} emphasis />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <Link
          href={incidentHref(organization.slug, incident.number)}
          className={cx(
            "group flex min-w-0 items-baseline gap-2 text-sm underline-offset-2",
            stretchedLinkClasses,
          )}
        >
          <span className="data shrink-0 text-fg-subtle">
            {incidentKey(incident.number)}
          </span>
          <span
            title={incident.title}
            className="truncate font-medium text-fg group-hover:text-accent-text group-hover:underline"
          >
            {incident.title}
          </span>
        </Link>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <OwnPart response={response} />
          <span>
            {incident.service.name} · {incident.team.name}
          </span>
          <StatusMark status={incident.status} />
        </p>
      </div>
    </li>
  );
}

/**
 * The incidents this member started investigating, most recent first, and
 * where their own part of each stands — the member page's link from a
 * person to the incidents they worked. Only actual responses: being on an
 * incident's team is not one. History, not a measure: no count, no totals.
 */
export function MemberResponses({
  membershipId,
  name,
}: {
  membershipId: string;
  name: string;
}) {
  const organization = useOrganization();
  const responses = useMemberResponses(organization.id, membershipId);

  let content;

  if (responses.isError) {
    content = <ErrorAlert error={responses.error} />;
  } else if (!responses.data) {
    content = <Spinner label="Loading responses…" />;
  } else {
    const items = responses.data.pages.flatMap((page) => page.items);

    content =
      items.length === 0 ? (
        <EmptyNote title="No incident responses yet">
          Incidents {name} starts investigating appear here.
        </EmptyNote>
      ) : (
        <>
          <ul
            aria-label="Recent responses"
            className="flex flex-col divide-y divide-line-subtle overflow-hidden rounded-md border border-line-subtle bg-surface"
          >
            {items.map((response) => (
              <ResponseRow key={response.incident.id} response={response} />
            ))}
          </ul>
          {responses.hasNextPage && (
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={responses.isFetchingNextPage}
                onClick={() => void responses.fetchNextPage()}
              >
                {responses.isFetchingNextPage ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </>
      );
  }

  return (
    <Section
      id="responses"
      title="Recent responses"
      description="Incidents they started investigating, most recent first."
    >
      {content}
    </Section>
  );
}
