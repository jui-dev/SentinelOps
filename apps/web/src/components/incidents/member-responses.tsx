"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { DetailCard } from "@/components/ui/detail-layout";
import { EmptyNote } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import {
  stretchedLinkClasses,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/table";
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

/**
 * One response, as a row: the incident first, then where it happened, then
 * their part in it and how the incident itself stands. The whole row opens
 * the incident, through its one link.
 */
function ResponseRow({ response }: { response: MemberResponseResponse }) {
  const organization = useOrganization();
  const { incident } = response;

  return (
    <TR interactive>
      <TD>
        <SeverityMark severity={incident.severity} emphasis />
      </TD>
      <TD>
        <Link
          href={incidentHref(organization.slug, incident.number)}
          className={cx(
            "group flex min-w-0 items-baseline gap-2 underline-offset-2",
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
        {/* Until there is room for their columns, where folds under the title. */}
        <span className="block truncate text-xs text-fg-muted lg:hidden">
          {incident.service.name} · {incident.team.name}
        </span>
      </TD>
      <TD className="hidden truncate lg:table-cell">{incident.service.name}</TD>
      <TD kind="muted" className="hidden truncate lg:table-cell">
        {incident.team.name}
      </TD>
      <TD className="text-sm whitespace-nowrap">
        <OwnPart response={response} />
      </TD>
      <TD className="hidden sm:table-cell">
        <StatusMark status={incident.status} />
      </TD>
    </TR>
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
  self = false,
}: {
  membershipId: string;
  name: string;
  /** Said to the member themselves: "your", "you". */
  self?: boolean;
}) {
  const organization = useOrganization();
  const responses = useMemberResponses(organization.id, membershipId);

  let content;

  let footer;

  if (responses.isError) {
    content = (
      <div className="p-4">
        <ErrorAlert error={responses.error} />
      </div>
    );
  } else if (!responses.data) {
    content = <Spinner label="Loading responses…" />;
  } else {
    const items = responses.data.pages.flatMap((page) => page.items);

    content =
      items.length === 0 ? (
        <EmptyNote title="No incident responses yet">
          {self
            ? "Incidents you start investigating appear here."
            : `Incidents ${name} starts investigating appear here.`}
        </EmptyNote>
      ) : (
        <Table
          label={self ? "Your recent responses" : "Recent responses"}
          variant="operational"
          fixed
        >
          <colgroup>
            <col className="w-21 sm:w-24" />
            <col />
            <col className="hidden w-[16%] lg:table-column" />
            <col className="hidden w-[13%] lg:table-column" />
            <col className="w-44" />
            <col className="hidden w-32 sm:table-column" />
          </colgroup>
          <THead>
            <TR>
              <TH>Severity</TH>
              <TH>Incident</TH>
              <TH className="hidden lg:table-cell">Service</TH>
              <TH className="hidden lg:table-cell">Team</TH>
              <TH>{self ? "Your part" : "Their part"}</TH>
              <TH className="hidden sm:table-cell">Incident status</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((response) => (
              <ResponseRow key={response.incident.id} response={response} />
            ))}
          </TBody>
        </Table>
      );
    footer = responses.hasNextPage && (
      <Button
        variant="secondary"
        size="sm"
        disabled={responses.isFetchingNextPage}
        onClick={() => void responses.fetchNextPage()}
      >
        {responses.isFetchingNextPage ? "Loading…" : "Show more"}
      </Button>
    );
  }

  return (
    <DetailCard
      id="responses"
      title={self ? "Your recent responses" : "Recent responses"}
      aside={`Incidents ${self ? "you" : name} started investigating, most recent first`}
      footer={footer || undefined}
    >
      {content}
    </DetailCard>
  );
}
