"use client";

import {
  CircleDashed,
  Eye,
  Network,
  Radio,
  Siren,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  incidentHref,
  useIncidentAttention,
  useIncidentList,
} from "@/components/incidents/incident-queries";
import { IncidentFlow } from "@/components/flow/incident-flow";
import { MemberResponses } from "@/components/incidents/member-responses";
import { LiveStatus } from "@/components/incidents/live-status";
import { incidentKey, SeverityMark } from "@/components/incidents/severity";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { useTeams } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import {
  CardRow,
  DetailCard,
  Glance,
  GlanceTile,
} from "@/components/ui/detail-layout";
import { EmptyNote } from "@/components/ui/empty-state";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Duration } from "@/components/ui/timestamp";
import { Permission } from "@/lib/api/contracts";
import type {
  IncidentDetailResponse,
  IncidentListItemResponse,
  TeamResponse,
} from "@/lib/api/contracts";

import { YourActivity } from "./your-activity";
import { YourTeams } from "./your-teams";
import { ButtonLink } from "@/components/ui/button-link";

/**
 * My Operations: where a member enters their organization.
 *
 * The Overview answers "how is the organization doing", which is oversight —
 * it counts every incident, including the ones a member may not open, so the
 * API answers it only to `incidents:read-all`. This page is the other
 * question, "what is mine": what is waiting on their teams, what they are
 * working on, and the teams they are on.
 *
 * Every figure is read from what the API already scopes to the caller —
 * their attention, their teams, the incidents they may see — and none is
 * borrowed from the organization's. Nothing is acted on here: each incident
 * links to its own page, where starting, posting, and finishing live.
 */

/** The tile's note: the incident keys, the first few, then how many more. */
const keysOf = (incidents: readonly { number: number }[]) =>
  incidents.length <= 2
    ? incidents.map(({ number }) => incidentKey(number)).join(" · ")
    : `${incidentKey(incidents[0].number)} and ${incidents.length - 1} more`;

/** The member's figures now, in four tiles. */
function YourWorkNow({
  assigned,
  waiting,
  investigating,
  active,
  teams,
}: {
  /** Assigned to the member by the Admin, not yet started. */
  assigned?: readonly IncidentDetailResponse[];
  waiting?: readonly IncidentDetailResponse[];
  investigating?: readonly IncidentDetailResponse[];
  /** Active incidents on the member's teams, once known. */
  active?: readonly IncidentListItemResponse[];
  teams?: readonly TeamResponse[];
}) {
  const sev1 = active?.filter(({ severity }) => severity === "SEV1").length ?? 0;
  const services = teams?.reduce((sum, team) => sum + team.serviceCount, 0) ?? 0;
  // Theirs to start: assigned to them, or open to their team. Each once.
  const ready =
    assigned && waiting
      ? new Set([...assigned, ...waiting].map(({ id }) => id)).size
      : undefined;

  return (
    <Glance label="Your work now" columns={4}>
      <GlanceTile
        label="Ready for you to start"
        value={ready ?? "—"}
        note={
          assigned && assigned.length > 0
            ? `${assigned.length} assigned to you`
            : ready
              ? "no one has started"
              : undefined
        }
        icon={CircleDashed}
        tone="warning"
        noteTone
      />
      <GlanceTile
        label="You're investigating"
        value={investigating?.length ?? "—"}
        note={
          investigating && investigating.length > 0
            ? keysOf(investigating)
            : undefined
        }
        icon={Radio}
        tone="investigating"
        noteTone
      />
      <GlanceTile
        label="Active on your teams"
        value={active?.length ?? "—"}
        note={sev1 > 0 ? `${sev1} × SEV1` : undefined}
        icon={Siren}
        tone="accent"
      />
      <GlanceTile
        label="Your teams"
        value={teams?.length ?? "—"}
        note={
          teams
            ? `${services} ${services === 1 ? "service" : "services"}`
            : undefined
        }
        icon={Network}
        tone="neutral"
      />
    </Glance>
  );
}

/** One incident in a work list: how serious, which, a moment, and View. */
function WorkRow({
  incident,
  moment,
}: {
  incident: IncidentDetailResponse;
  moment: ReactNode;
}) {
  const organization = useOrganization();
  const key = incidentKey(incident.number);
  const critical = incident.severity === "SEV1";

  return (
    <TR>
      <TD
        className={cx(
          "relative",
          critical &&
            "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-signal-critical",
        )}
      >
        <SeverityMark severity={incident.severity} emphasis />
      </TD>
      <TD>
        <span className="flex min-w-0 flex-col py-1.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="data shrink-0 text-fg-subtle">{key}</span>
            <span title={incident.title} className="truncate font-medium text-fg">
              {incident.title}
            </span>
          </span>
          <span className="truncate text-xs text-fg-subtle">
            {incident.service.name} · {incident.team.name}
          </span>
        </span>
      </TD>
      <TD kind="data">{moment}</TD>
      <TD align="end">
        <ButtonLink
          href={incidentHref(organization.slug, incident.number)}
          aria-label={`View ${key}`}
          variant="view"
          size="sm"
          icon={Eye}
        >
          View
        </ButtonLink>
      </TD>
    </TR>
  );
}

/** One of the two work lists, as a card holding a table. */
function WorkCard({
  id,
  title,
  aside,
  footer,
  when,
  incidents,
  moment,
  empty,
}: {
  id: string;
  title: string;
  aside: string;
  footer: string;
  /** The heading of the moment column. */
  when: string;
  incidents: readonly IncidentDetailResponse[];
  moment: (incident: IncidentDetailResponse) => ReactNode;
  empty: { title: string; body: string };
}) {
  return (
    <DetailCard
      id={id}
      title={title}
      meta={incidents.length}
      aside={aside}
      footer={footer}
    >
      {incidents.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyNote title={empty.title}>{empty.body}</EmptyNote>
        </div>
      ) : (
        <Table label={title} count={incidents.length} variant="operational"
          columns={["severity", "main", "datetime", "actions"]}
        >
          <THead>
            <TR>
              <TH>Severity</TH>
              <TH>Incident</TH>
              <TH>{when}</TH>
              <TH align="end">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {incidents.map((incident) => (
              <WorkRow
                key={incident.id}
                incident={incident}
                moment={moment(incident)}
              />
            ))}
          </TBody>
        </Table>
      )}
    </DetailCard>
  );
}

/** When the caller's own response on this incident began. */
const yourStart = (
  incident: IncidentDetailResponse,
  membershipId: string,
) =>
  incident.responders.find((responder) => responder.membershipId === membershipId)
    ?.startedAt;

/** The page's body for a member who may read incidents. */
function YourOperations() {
  const organization = useOrganization();
  const attention = useIncidentAttention(organization.id, { poll: true });
  const teams = useTeams(organization.id);
  const list = useIncidentList(organization.id, "active", undefined, {}, true, true);

  const respond = attention.data?.respond ?? null;
  const teamIds = new Set(teams.data?.map(({ id }) => id));
  const active = list.data
    ? list.data.pages
        .flatMap((page) => page.items)
        .filter((incident) => teamIds.has(incident.team.id))
    : undefined;
  const onNoTeam = teams.data?.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {attention.isError && !attention.data && (
        <ErrorAlert error={attention.error} />
      )}
      <YourWorkNow
        assigned={respond?.assignedToYou}
        waiting={respond?.needsYourTeam}
        investigating={respond?.yourResponses}
        active={teams.data ? active : undefined}
        teams={teams.data}
      />
      {onNoTeam && (
        <EmptyNote title="You're not on a team yet">
          Incidents reach you through the teams you are on, or when the Admin
          assigns you to one. Once the Admin places you on a team, its
          incidents appear here.
        </EmptyNote>
      )}
      {!attention.data && !attention.isError ? (
        <Spinner label="Loading your work…" />
      ) : (
        respond && (
          <>
            {respond.assignedToYou.length > 0 && (
              <WorkCard
                id="assigned-to-you"
                title="Assigned to you"
                aside="Start from the incident's page"
                footer="The Admin asked you to respond to these. Only the people assigned can start them."
                when="Open for"
                incidents={respond.assignedToYou}
                moment={(incident) => (
                  <span className="text-warning-text">
                    <Duration from={incident.createdAt} />
                  </span>
                )}
                empty={{ title: "", body: "" }}
              />
            )}
            <CardRow layout="halves">
              <WorkCard
                id="waiting-on-your-team"
                title="Waiting on your team"
                aside="Start from the incident's page"
                footer="Incidents open to your teams that nobody on the team has started yet."
                when="Open for"
                incidents={respond.needsYourTeam}
                moment={(incident) => (
                  <span className="text-warning-text">
                    <Duration from={incident.createdAt} />
                  </span>
                )}
                empty={{
                  title: "Nothing waiting",
                  body: "Every incident on your teams has someone on it.",
                }}
              />
              <WorkCard
                id="you-are-investigating"
                title="You're investigating"
                aside="Post updates and finish from the incident's page"
                footer="Your own responses still under way, whichever team has the incident now."
                when="You started"
                incidents={respond.yourResponses}
                moment={(incident) => {
                  const started = yourStart(
                    incident,
                    organization.membership.id,
                  );

                  return started ? (
                    <>
                      <Duration from={started} /> ago
                    </>
                  ) : (
                    "—"
                  );
                }}
                empty={{
                  title: "Nothing under way",
                  body: "Incidents you start investigating appear here until you finish.",
                }}
              />
            </CardRow>
          </>
        )
      )}
      {teams.data && teams.data.length > 0 && <IncidentFlow scope="teams" />}
      <CardRow>
        {teams.data && teams.data.length > 0 ? (
          <YourTeams teams={teams.data} />
        ) : (
          <div />
        )}
        <YourActivity />
      </CardRow>
      <MemberResponses
        membershipId={organization.membership.id}
        name="you"
        self
      />
    </div>
  );
}

export function MyOperations() {
  const organization = useOrganization();
  const canReadIncidents = useCan(Permission.INCIDENTS_READ);
  const teams = useTeams(organization.id);
  const attention = useIncidentAttention(organization.id, {
    poll: true,
    enabled: canReadIncidents,
  });

  return (
    <>
      <PageHeader
        width="full"
        title="My Operations"
        description="What is waiting on your teams, and what you are working on."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            {canReadIncidents && attention.data && (
              <LiveStatus
                updatedAt={attention.dataUpdatedAt}
                failed={attention.isRefetchError}
              />
            )}
            {teams.data && teams.data.length > 0 && (
              <ul aria-label="Your teams" className="flex flex-wrap gap-1.5">
                {teams.data.map((team) => (
                  <li
                    key={team.id}
                    className="rounded-full border border-accent-line bg-accent-subtle px-3 py-0.5 text-sm text-accent-text"
                  >
                    {team.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
      />
      <PageBody width="full">
        {canReadIncidents ? (
          <YourOperations />
        ) : (
          <EmptyNote title="No incidents to show">
            Your role does not include reading incidents.
          </EmptyNote>
        )}
      </PageBody>
    </>
  );
}
