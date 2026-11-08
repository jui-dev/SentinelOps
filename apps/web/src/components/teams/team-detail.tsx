"use client";

import { ArrowRight, Boxes, CircleCheck, Siren, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { initialsOf } from "@/components/app/shell-utilities";
import {
  incidentsHref,
  useIncidentList,
} from "@/components/incidents/incident-queries";
import { IncidentTable } from "@/components/incidents/incident-table";
import { SEVERITY_LEVELS } from "@/components/incidents/severity";
import { memberHref, membersHref } from "@/components/organizations/member-paths";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { CriticalityMark } from "@/components/services/criticality-mark";
import { serviceHref, useServices } from "@/components/services/service-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { linkClasses, quietLinkClasses } from "@/components/ui/link";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { Permission } from "@/lib/api/contracts";
import type { IncidentResponse } from "@/lib/api/contracts";
import { lastUtcDays } from "@/lib/period/period";

import { teamsHref, useTeam, useTeamMembers } from "./team-scope";

/** How many members, services, or resolved incidents a card shows at first. */
const MEMBERS_SHOWN = 6;
const SERVICES_SHOWN = 5;
const RESOLVED_SHOWN = 5;

/** The days the Resolved tile counts. */
const RESOLVED_DAYS = 30;

/**
 * Past this height a card's list scrolls inside the card rather than
 * growing it, so a row's two cards stay level — about six rows. Only from
 * `sm`: on a phone the page itself is the one scroll.
 */
const SCROLL_REGION =
  "sm:max-h-84 sm:overflow-y-auto sm:overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

/** A page's count, honest about a first page that is not the whole list. */
const countOf = (items: readonly unknown[], hasMore: boolean) =>
  hasMore ? `${items.length}+` : String(items.length);

// ── The summary band ────────────────────────────────────────────────────────

type Tone = "accent" | "info" | "warning" | "resolved";

/** Each tile's icon square: a quiet fill in one of the system's own tones. */
const CHIPS: Record<Tone, string> = {
  accent: "border-accent-line bg-accent-subtle text-accent-text",
  info: "border-info-line bg-info-subtle text-info-text",
  warning: "border-warning-line bg-warning-subtle text-warning-text",
  resolved:
    "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text",
};

/** A tile's note in its tone, for a figure that wants noticing. */
const NOTE_TONES: Record<Tone, string> = {
  accent: "text-accent-text",
  info: "text-info-text",
  warning: "text-warning-text",
  resolved: "text-status-resolved-text",
};

function Tile({
  label,
  value,
  note,
  icon: Icon,
  tone,
  noteTone = false,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  icon: LucideIcon;
  tone: Tone;
  /** Whether the note carries the tile's tone, for what wants noticing. */
  noteTone?: boolean;
}) {
  return (
    // The term and its value are the group's own children, as a <dl> asks;
    // the icon sits in the term, placed at the tile's leading edge.
    <div className="relative flex min-w-0 flex-col justify-center gap-0.5 rounded-lg border border-line bg-surface py-3.5 pr-4 pl-17">
      <dt className="text-sm text-fg-muted">
        <span
          aria-hidden="true"
          className={cx(
            "absolute top-1/2 left-4 grid size-9.5 -translate-y-1/2 place-items-center rounded-lg border",
            CHIPS[tone],
          )}
        >
          <Icon strokeWidth={1.75} className="size-4.5" />
        </span>
        {label}
      </dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        <span className="numeric text-2xl leading-tight font-semibold text-fg">
          {value}
        </span>
        {note && (
          <span
            className={cx(
              "text-xs",
              noteTone ? NOTE_TONES[tone] : "text-fg-subtle",
            )}
          >
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}

/** The most severe level among the active incidents, and how many have it. */
const worstOf = (incidents: readonly IncidentResponse[]) => {
  for (const { value } of SEVERITY_LEVELS) {
    const count = incidents.filter((each) => each.severity === value).length;

    if (count > 0) return `${count} × ${value}`;
  }

  return undefined;
};

function IncidentTiles({ teamId }: { teamId: string }) {
  const organization = useOrganization();
  // The Active card's own query, by key: one request for both.
  const active = useIncidentList(organization.id, "active", undefined, {
    teamId,
  });
  const resolved = useIncidentList(
    organization.id,
    "resolved",
    lastUtcDays(RESOLVED_DAYS, new Date()),
    { teamId },
  );
  const activePage = active.data?.pages[0];
  const resolvedPage = resolved.data?.pages[0];

  return (
    <>
      <Tile
        label="Active incidents"
        icon={Siren}
        tone="warning"
        noteTone
        value={activePage ? countOf(activePage.items, activePage.page.hasMore) : "–"}
        note={activePage && worstOf(activePage.items)}
      />
      <Tile
        label="Resolved"
        icon={CircleCheck}
        tone="resolved"
        value={
          resolvedPage
            ? countOf(resolvedPage.items, resolvedPage.page.hasMore)
            : "–"
        }
        note={`last ${RESOLVED_DAYS} days`}
      />
    </>
  );
}

/**
 * The team at a glance, in a band of the rail's own ground: who is on it,
 * what it owns, and — for those who read incidents — what it is handling.
 */
function TeamGlance({ canReadIncidents }: { canReadIncidents: boolean }) {
  const team = useTeam();

  return (
    <dl
      aria-label={`${team.name} at a glance`}
      className={cx(
        "grid gap-3 rounded-xl border border-line-subtle bg-linear-to-b from-rail-top to-rail-mid p-3.5",
        canReadIncidents
          ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
          : "grid-cols-1 sm:grid-cols-2",
      )}
    >
      <Tile label="Members" icon={Users} tone="accent" value={team.memberCount} />
      <Tile
        label="Services owned"
        icon={Boxes}
        tone="info"
        value={team.serviceCount}
      />
      {canReadIncidents && <IncidentTiles teamId={team.id} />}
    </dl>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────

/**
 * One of the page's cards: a header band of one height, its content, and a
 * note pinned to its foot — so two cards side by side line up top, header,
 * and bottom whatever each holds.
 */
function Card({
  id,
  title,
  meta,
  aside,
  action,
  footer,
  className,
  children,
}: {
  id: string;
  title: string;
  meta?: ReactNode;
  /** A short line beside the title: what the card covers. */
  aside?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cx(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface",
        className,
      )}
    >
      <div className="flex min-h-13 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-thead px-4 py-2 sm:px-5">
        <h2 id={`${id}-title`} className="text-base font-semibold text-fg">
          {title}
          {meta !== undefined && (
            <span className="numeric ml-1.5 font-normal text-fg-subtle">
              {meta}
            </span>
          )}
        </h2>
        {aside && <span className="text-sm text-fg-muted">{aside}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="flex-1">{children}</div>
      {footer && (
        <div className="border-t border-line-subtle px-4 py-2.5 text-xs leading-relaxed text-fg-subtle sm:px-5">
          {footer}
        </div>
      )}
    </section>
  );
}

/** Two cards side by side, level with each other; stacked on a phone. */
function CardRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      {children}
    </div>
  );
}

function OnwardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-1.5 text-sm text-fg-muted ${quietLinkClasses}`}
    >
      {children}
      <ArrowRight
        aria-hidden="true"
        className="size-3.5 text-fg-subtle group-hover:text-accent-text"
      />
    </Link>
  );
}

/** "Show all 15" and back: the list stays in its card, which scrolls. */
function ShowAllToggle({
  total,
  expanded,
  onToggle,
  controls,
}: {
  total: number;
  expanded: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className={`text-sm ${linkClasses}`}
    >
      {expanded ? "Show fewer" : `Show all ${total}`}
    </button>
  );
}

const viewAllHref = (orgSlug: string, teamId: string) =>
  `${incidentsHref(orgSlug)}?${new URLSearchParams({ team: teamId })}`;

function ActiveIncidents() {
  const organization = useOrganization();
  const team = useTeam();
  const list = useIncidentList(organization.id, "active", undefined, {
    teamId: team.id,
  });
  const items = list.data?.pages[0]?.items;

  return (
    <Card
      id="active-incidents"
      title="Active incidents"
      meta={items?.length}
      aside={`${team.name} is responsible for these now`}
      action={
        <OnwardLink href={viewAllHref(organization.slug, team.id)}>
          View all in Incidents
        </OnwardLink>
      }
    >
      {list.isError ? (
        <div className="p-4">
          <ErrorAlert error={list.error} />
        </div>
      ) : !items ? (
        <Spinner label="Loading active incidents…" />
      ) : items.length === 0 ? (
        <EmptyNote
          title="No active incidents"
          glyph={
            <svg viewBox="0 0 10 10" className="size-2.5 text-signal-nominal">
              <circle cx="5" cy="5" r="3.75" fill="currentColor" />
            </svg>
          }
        >
          Nothing here needs a response right now.
        </EmptyNote>
      ) : (
        // Every active incident, in the card: past six it scrolls.
        <div
          role="region"
          aria-label={`Active incidents of ${team.name}`}
          tabIndex={0}
          className={SCROLL_REGION}
        >
          <IncidentTable
            incidents={items}
            state="active"
            label="Active incidents"
            stickyHeader
            showTeam={false}
          />
        </div>
      )}
    </Card>
  );
}

function RecentlyResolved() {
  const organization = useOrganization();
  const team = useTeam();
  const list = useIncidentList(organization.id, "resolved", undefined, {
    teamId: team.id,
  });
  const items = list.data?.pages[0]?.items;

  return (
    <Card
      id="resolved-incidents"
      title="Recently resolved"
      aside="Most recent first"
      footer={
        items && items.length > 0 ? (
          <OnwardLink href={viewAllHref(organization.slug, team.id)}>
            View all in Incidents
          </OnwardLink>
        ) : undefined
      }
    >
      {list.isError ? (
        <div className="p-4">
          <ErrorAlert error={list.error} />
        </div>
      ) : !items ? (
        <Spinner label="Loading resolved incidents…" />
      ) : items.length === 0 ? (
        <EmptyNote title="None resolved yet">
          Resolved incidents appear here, most recent first.
        </EmptyNote>
      ) : (
        <IncidentTable
          incidents={items.slice(0, RESOLVED_SHOWN)}
          state="resolved"
          label="Recently resolved incidents"
          showTeam={false}
        />
      )}
    </Card>
  );
}

/**
 * Who is on the team, read only. Placement is changed on each member's own
 * page, so there is one place to do it: this card says where.
 */
function Members() {
  const organization = useOrganization();
  const team = useTeam();
  const members = useTeamMembers(organization.id, team.id);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const all = members.data ?? [];
  const shown = expanded ? all : all.slice(0, MEMBERS_SHOWN);

  return (
    <Card
      id="members"
      title="Members"
      meta={members.data?.length}
      action={
        all.length > MEMBERS_SHOWN && (
          <ShowAllToggle
            total={all.length}
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            controls={listId}
          />
        )
      }
      footer={
        <>
          To add or remove someone, open their profile under{" "}
          <Link href={membersHref(organization.slug)} className={linkClasses}>
            Members
          </Link>
          .
        </>
      }
    >
      {members.isError ? (
        <div className="p-4">
          <ErrorAlert error={members.error} />
        </div>
      ) : !members.data ? (
        <Spinner label="Loading team members…" />
      ) : all.length === 0 ? (
        <EmptyNote title="No one is on this team yet">
          People are placed on a team from their profile.
        </EmptyNote>
      ) : (
        <ul
          id={listId}
          aria-label={`Members of ${team.name}`}
          tabIndex={expanded ? 0 : undefined}
          className={cx("divide-y divide-line-subtle", expanded && SCROLL_REGION)}
        >
          {shown.map((member) => (
            <li
              key={member.membershipId}
              className="flex items-center gap-3 px-4 py-2.5 sm:px-5"
            >
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full border border-accent-line bg-accent-subtle text-xs font-semibold text-accent-text"
              >
                {initialsOf(member.user.name)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-fg">
                  {member.user.name}
                </span>
                <span className="truncate text-xs text-fg-subtle">
                  {member.user.email}
                </span>
              </span>
              <Link
                href={memberHref(organization.slug, member.membershipId)}
                aria-label={`${member.user.name}’s profile`}
                className={`shrink-0 text-sm ${linkClasses}`}
              >
                Profile →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The services this team owns, read from the organization's service list —
 * the one the Services pages use, so there is one cache to keep current.
 */
function OwnedServices() {
  const organization = useOrganization();
  const team = useTeam();
  const services = useServices(organization.id);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const owned = services.data?.filter(
    (service) => service.ownerTeam.id === team.id,
  );
  const shown = owned && (expanded ? owned : owned.slice(0, SERVICES_SHOWN));

  return (
    <Card
      id="services"
      title="Services owned"
      meta={owned?.length}
      action={
        owned &&
        owned.length > SERVICES_SHOWN && (
          <ShowAllToggle
            total={owned.length}
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            controls={listId}
          />
        )
      }
      footer={`Incidents on these services come to ${team.name}.`}
    >
      {services.isError ? (
        <div className="p-4">
          <ErrorAlert error={services.error} />
        </div>
      ) : !shown ? (
        <Spinner label="Loading services…" />
      ) : shown.length === 0 ? (
        <EmptyNote title="This team owns no services">
          A service names its owner team when it is created or edited.
        </EmptyNote>
      ) : (
        <ul
          id={listId}
          aria-label={`Services owned by ${team.name}`}
          tabIndex={expanded ? 0 : undefined}
          className={cx("divide-y divide-line-subtle", expanded && SCROLL_REGION)}
        >
          {shown.map((service) => (
            <li key={service.id}>
              <Link
                href={serviceHref(organization.slug, service.slug)}
                className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-(--duration-fast) hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-fg">
                  {service.name}
                  {service.archivedAt && (
                    <span className="font-normal text-fg-muted"> (archived)</span>
                  )}
                </span>
                <CriticalityMark criticality={service.criticality} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

/**
 * A team: what it is for, a glance at its size and load, the incidents it
 * is responsible for, who is on it, and what it owns. Read here; changed
 * where each thing belongs — placement on a member's page, the team itself
 * from the Teams list.
 */
export function TeamDetail() {
  const organization = useOrganization();
  const team = useTeam();
  const canReadServices = useCan(Permission.SERVICES_READ);
  const canReadIncidents = useCan(Permission.INCIDENTS_READ);

  return (
    <>
      {/* Operational, like the Overview and Incidents: their full width. */}
      <PageHeader
        width="full"
        eyebrow={
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2">
              <li>
                <Link
                  href={teamsHref(organization.slug)}
                  className="rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Teams
                </Link>
              </li>
              <li aria-hidden="true" className="text-fg-subtle">
                /
              </li>
              <li aria-current="page" className="text-fg-muted">
                {team.name}
              </li>
            </ol>
          </nav>
        }
        title={team.name}
        description={team.description ?? undefined}
      />
      <PageBody width="full">
        <div className="flex flex-col gap-6">
          <TeamGlance canReadIncidents={canReadIncidents} />
          {canReadIncidents ? (
            <>
              <CardRow>
                <ActiveIncidents />
                <Members />
              </CardRow>
              <CardRow>
                <RecentlyResolved />
                {canReadServices ? <OwnedServices /> : <div />}
              </CardRow>
            </>
          ) : (
            <CardRow>
              <Members />
              {canReadServices && <OwnedServices />}
            </CardRow>
          )}
        </div>
      </PageBody>
    </>
  );
}
