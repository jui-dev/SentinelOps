"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { ActivityCalendar } from "@/components/activity/activity-calendar";
import { incidentHref } from "@/components/incidents/incident-queries";
import { incidentKey, SeverityMark } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { DetailCard } from "@/components/ui/detail-layout";
import { Spinner } from "@/components/ui/spinner";
import { useMinuteClock } from "@/components/ui/timestamp";
import type { MemberActivityDayResponse } from "@/lib/api/contracts";
import { getMemberActivity } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { lastUtcDays } from "@/lib/period/period";

/**
 * Your activity: when the member did response work over the last six
 * months — responses started, updates posted, responses finished — one
 * square a day, in the quiet personal ramp, never the organization's.
 *
 * Their own rhythm, for them: how much they did is never compared with
 * anyone, and nobody else's activity is asked for. Choosing a day says what
 * it held and which incidents, each one link.
 */

/** About six months of whole UTC days, ending today. */
const ACTIVITY_DAYS = 182;

const DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** What the member did on a day, in words. */
const describeDay = (day: { total: number }) => {
  const { counts } = day as MemberActivityDayResponse;

  if (day.total === 0 || !counts) return "nothing";

  return [
    counts.responseStarted > 0 &&
      plural(counts.responseStarted, "response started", "responses started"),
    counts.update > 0 && plural(counts.update, "update", "updates"),
    counts.responseCompleted > 0 &&
      plural(counts.responseCompleted, "response finished", "responses finished"),
  ]
    .filter(Boolean)
    .join(", ");
};

function ChosenDay({ day }: { day: MemberActivityDayResponse }) {
  const organization = useOrganization();

  return (
    <div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
      <p className="text-sm">
        <span className="font-semibold text-fg">
          {DAY.format(new Date(`${day.date}T00:00:00.000Z`))}
        </span>
        <span className="text-fg-muted"> · {describeDay(day)}</span>
      </p>
      {day.incidents.length > 0 && (
        <ul aria-label="Incidents you worked on that day" className="flex flex-col gap-1.5">
          {day.incidents.map((incident) => (
            <li key={incident.id} className="flex min-w-0 items-center gap-2 text-sm">
              <SeverityMark severity={incident.severity} className="shrink-0 text-xs" />
              <Link
                href={incidentHref(organization.slug, incident.number)}
                className="flex min-w-0 items-baseline gap-2 rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
              >
                <span className="data shrink-0 text-xs text-fg-subtle">
                  {incidentKey(incident.number)}
                </span>
                <span className="truncate text-fg">{incident.title}</span>
              </Link>
            </li>
          ))}
          {day.moreIncidents > 0 && (
            <li className="text-xs text-fg-subtle">and {day.moreIncidents} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function YourActivity() {
  const organization = useOrganization();
  const period = lastUtcDays(ACTIVITY_DAYS, useMinuteClock());
  const membershipId = organization.membership.id;
  const activity = useQuery({
    queryKey: queryKeys.memberActivity(organization.id, membershipId, period.from, period.to),
    queryFn: () => getMemberActivity(organization.id, membershipId, period),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const day = activity.data?.days.find(({ date }) => date === selected) ?? null;

  let content;

  if (activity.isError) {
    content = (
      <div className="p-4 sm:p-5">
        <ErrorAlert error={activity.error} />
      </div>
    );
  } else if (!activity.data) {
    content = (
      <div className="grid min-h-40 place-items-center">
        <Spinner label="Loading your activity…" />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
        <ActivityCalendar
          days={activity.data.days}
          label="Your activity over the last six months"
          variant="personal"
          selected={day?.date ?? null}
          onSelect={setSelected}
          describeDay={describeDay}
          today={activity.data.to}
        />
        {day ? (
          <ChosenDay day={day} />
        ) : (
          <p className="text-sm text-fg-muted">
            {activity.data.activeDays === 0 ? (
              "Nothing yet: days you start, update, or finish a response fill in here."
            ) : (
              <>
                Active on{" "}
                <span className="numeric font-semibold text-fg">
                  {activity.data.activeDays}
                </span>{" "}
                {activity.data.activeDays === 1 ? "day" : "days"}.{" "}
                <span className="text-fg-subtle">Select a day to see what you did.</span>
              </>
            )}
          </p>
        )}
      </div>
    );
  }

  return (
    <DetailCard
      id="your-activity"
      title="Your activity"
      aside="Responses started, updates posted, responses finished · last 6 months"
    >
      {content}
    </DetailCard>
  );
}
