"use client";

import Link from "next/link";

import { useOrganization } from "@/components/organizations/organization-scope";
import { cx } from "@/components/ui/cx";
import {
  stretchedLinkClasses,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/table";
import { Duration, IsoDate } from "@/components/ui/timestamp";
import type { IncidentResponse, IncidentState } from "@/lib/api/contracts";

import { incidentHref } from "./incident-queries";
import { incidentKey, SeverityMark, StatusMark, statusOf } from "./severity";

/**
 * One row: what, where, who, and how it stands — in that order of weight.
 * The whole row opens the incident, through its one link. A SEV1 row also
 * carries a bar at its leading edge; the mark and the words still say it.
 */
function IncidentRow({
  incident,
  state,
  showService,
  showTeam,
}: {
  incident: IncidentResponse;
  state: IncidentState;
  showService: boolean;
  showTeam: boolean;
}) {
  const organization = useOrganization();
  const active = state === "active";
  const critical = incident.severity === "SEV1";

  return (
    <TR interactive>
      <TD
        className={cx(
          "relative",
          critical &&
            "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-signal-critical",
        )}
      >
        <SeverityMark severity={incident.severity} emphasis />
        {!incident.severityConfirmed && (
          <span className="ml-1.5 text-2xs font-semibold text-warning-text">
            Suggested
          </span>
        )}
      </TD>
      <TD>
        <Link
          href={incidentHref(organization.slug, incident.number)}
          className={cx(
            // On a phone the key sits above the title, which may wrap.
            "group flex min-w-0 flex-col underline-offset-2 sm:flex-row sm:items-baseline sm:gap-2",
            stretchedLinkClasses,
          )}
        >
          <span className="data shrink-0 text-fg-subtle sm:min-w-[4.25rem]">
            {incidentKey(incident.number)}
          </span>{" "}
          <span
            title={incident.title}
            className="line-clamp-2 font-medium text-fg group-hover:text-accent-text group-hover:underline sm:line-clamp-none sm:truncate"
          >
            {incident.title}
          </span>
        </Link>
        {/*
         * Until the workspace is wide enough for their columns (xl), the
         * service and team fold under the title — and on a phone the status
         * too — so the title always keeps its room.
         */}
        <span className="block truncate text-xs text-fg-muted sm:pl-[calc(4.25rem+0.5rem)] xl:hidden">
          {active && (
            <span className="sm:hidden">
              {statusOf(incident.status).label} ·{" "}
            </span>
          )}
          {[showService && incident.service.name, showTeam && incident.team.name]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </TD>
      {showService && (
        <TD className="hidden truncate xl:table-cell">{incident.service.name}</TD>
      )}
      {showTeam && (
        <TD kind="muted" className="hidden truncate xl:table-cell">
          {incident.team.name}
        </TD>
      )}
      {active ? (
        <>
          {/* In body text, not muted: status is read down the column. */}
          <TD className="hidden sm:table-cell">
            <StatusMark status={incident.status} />
          </TD>
          <TD
            align="end"
            className={cx(
              "data whitespace-nowrap",
              critical ? "text-fg" : "text-fg-muted",
            )}
          >
            <Duration from={incident.createdAt} />
          </TD>
        </>
      ) : (
        <>
          <TD kind="data" className="hidden sm:table-cell">
            {incident.resolvedAt && <IsoDate value={incident.resolvedAt} />}
          </TD>
          <TD kind="data" align="end">
            <Duration from={incident.createdAt} to={incident.resolvedAt} />
          </TD>
        </>
      )}
    </TR>
  );
}

/**
 * Incidents of one state as the operational table every incident list
 * shares — the Incidents page, and a service's or team's own: severity,
 * the incident, its service and team, then how it stands (active) or when
 * it was resolved and how long it lasted (resolved). Fixed widths, so titles
 * truncate exactly and columns never jump.
 */
export function IncidentTable({
  incidents,
  state,
  label,
  stickyHeader = false,
  showService = true,
  showTeam = true,
}: {
  incidents: readonly IncidentResponse[];
  state: IncidentState;
  label: string;
  stickyHeader?: boolean;
  /** False where every row is the same service — a service's own page. */
  showService?: boolean;
  /**
   * False where every row's team is the same one — a team's own page — so
   * the column's room goes to the titles instead of repeating a name.
   */
  showTeam?: boolean;
}) {
  const active = state === "active";

  return (
    <Table
      label={label}
      variant="operational"
      stickyHeader={stickyHeader}
          columns={[
            "severity",
            "main",
            ...(showService ? [{ kind: "group", from: "xl" } as const] : []),
            ...(showTeam ? [{ kind: "group", from: "xl" } as const] : []),
            { kind: "status", from: "sm" },
            "duration",
          ]}
        >
      <THead>
        <TR>
          <TH>Severity</TH>
          <TH>Incident</TH>
          {showService && <TH className="hidden xl:table-cell">Service</TH>}
          {showTeam && (
            <TH className="hidden xl:table-cell">Responsible team</TH>
          )}
          {active ? (
            <>
              <TH className="hidden sm:table-cell">Status</TH>
              <TH align="end">Duration</TH>
            </>
          ) : (
            <>
              <TH className="hidden sm:table-cell">Resolved</TH>
              <TH align="end">Lasted</TH>
            </>
          )}
        </TR>
      </THead>
      <TBody>
        {incidents.map((incident) => (
          <IncidentRow
            key={incident.id}
            incident={incident}
            state={state}
            showService={showService}
            showTeam={showTeam}
          />
        ))}
      </TBody>
    </Table>
  );
}
