"use client";

import { CircleCheck, Hourglass, Wrench } from "lucide-react";
import Link from "next/link";

import {
  incidentHref,
  incidentsHref,
  useIncidentList,
} from "@/components/incidents/incident-queries";
import { SeverityMark, incidentKey } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { Glance, GlanceTile } from "@/components/ui/detail-layout";
import { EmptyNote } from "@/components/ui/empty-state";
import { linkClasses } from "@/components/ui/link";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import type { IncidentListItemResponse } from "@/lib/api/contracts";
import { useCurrentUser } from "@/lib/auth/session-provider";

type Report = IncidentListItemResponse;

/** Where one report stands, as its Reporter would ask it. */
const standing = (
  report: Report,
): { label: string; detail: string; tone: "amber" | "blue" | "teal" } => {
  if (report.status === "RESOLVED") {
    return { label: "Resolved", detail: "How it ended is on its page", tone: "teal" };
  }
  if (report.responseAccess === "PENDING") {
    return {
      label: "Waiting for a decision",
      detail: report.severityConfirmed
        ? "Nobody has been chosen to respond yet"
        : `Your suggested ${report.severity} is waiting to be confirmed`,
      tone: "amber",
    };
  }

  const working = report.response.investigating;
  const who =
    report.responseAccess === "ASSIGNED"
      ? `Assigned to ${report.assignees.map(({ name }) => name).join(", ")}`
      : `Open to ${report.team.name}`;

  return {
    label: working > 0 ? "Being worked on" : "Waiting for a responder",
    detail:
      working > 0
        ? `${who} · ${working} investigating`
        : `${who} · nobody has started yet`,
    tone: working > 0 ? "blue" : "amber",
  };
};

const TONES = {
  amber: "border-warning-line bg-warning-subtle text-warning-text",
  blue: "border-status-investigating-line bg-status-investigating-subtle text-status-investigating-text",
  teal: "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text",
};

function ReportRow({ report }: { report: Report }) {
  const organization = useOrganization();
  const where = standing(report);

  return (
    <li>
      <Link
        href={incidentHref(organization.slug, report.number)}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line-subtle bg-surface px-4 py-3.5 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="data text-sm text-fg-subtle">
              {incidentKey(report.number)}
            </span>
            <span className="truncate font-semibold text-fg">{report.title}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            <SeverityMark severity={report.severity} label />
            {!report.severityConfirmed && (
              <span className="font-semibold text-warning-text">Suggested</span>
            )}
            <span>{report.service.name}</span>
          </span>
        </span>
        <span className="flex flex-col items-start gap-1 sm:items-end">
          <span
            className={cx(
              "inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-semibold",
              TONES[where.tone],
            )}
          >
            {where.label}
          </span>
          <span className="text-xs text-fg-subtle">{where.detail}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The home of someone who raises incidents rather than working them — a
 * Reporter: what they declared, and where each stands. Waiting for a
 * decision, being worked on, or resolved. Declaring is the Incidents
 * page's, and only linked to here.
 */
export function MyReports() {
  const organization = useOrganization();
  const me = useCurrentUser();
  const active = useIncidentList(organization.id, "active", undefined, {}, true, true);
  const resolved = useIncidentList(organization.id, "resolved");
  // Theirs alone: someone who is also on a team reads its incidents too.
  const mine = (list: typeof active) =>
    list.data?.pages
      .flatMap((page) => page.items)
      .filter((report) => report.createdBy.id === me.data?.id);
  const open = mine(active);
  const done = mine(resolved)?.slice(0, 5);
  const waiting = open?.filter((report) => report.responseAccess === "PENDING");
  const worked = open?.filter((report) => report.responseAccess !== "PENDING");

  return (
    <>
      <PageHeader
        width="full"
        title="My reports"
        description={
          <>
            The incidents you declared, and where each one stands. Declare
            a new one from{" "}
            <Link href={incidentsHref(organization.slug)} className={linkClasses}>
              Incidents
            </Link>
            .
          </>
        }
      />
      <PageBody width="full">
        {active.isError && <ErrorAlert error={active.error} />}
        {!open ? (
          <Spinner label="Loading your reports…" />
        ) : (
          <>
            <Glance label="Your reports at a glance" columns={3}>
              <GlanceTile
                label="Waiting for a decision"
                icon={Hourglass}
                tone="warning"
                value={waiting?.length ?? 0}
              />
              <GlanceTile
                label="Being worked on"
                icon={Wrench}
                tone="investigating"
                value={worked?.length ?? 0}
              />
              <GlanceTile
                label="Resolved recently"
                icon={CircleCheck}
                tone="resolved"
                value={done?.length ?? 0}
                note="Your last five"
              />
            </Glance>

            <section aria-labelledby="open-h" className="flex flex-col gap-3">
              <h2 id="open-h" className="text-lg font-semibold text-fg">
                Active
              </h2>
              {open.length === 0 ? (
                <EmptyNote title="Nothing you declared is active">
                  When something is wrong, declare it from Incidents. An
                  Incident Manager decides who responds, and you&apos;ll be told
                  how it ends.
                </EmptyNote>
              ) : (
                <ul className="flex flex-col gap-2">
                  {open.map((report) => (
                    <ReportRow key={report.id} report={report} />
                  ))}
                </ul>
              )}
            </section>

            {done && done.length > 0 && (
              <section aria-labelledby="done-h" className="flex flex-col gap-3">
                <h2 id="done-h" className="text-lg font-semibold text-fg">
                  Resolved recently
                </h2>
                <ul className="flex flex-col gap-2">
                  {done.map((report) => (
                    <ReportRow key={report.id} report={report} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
