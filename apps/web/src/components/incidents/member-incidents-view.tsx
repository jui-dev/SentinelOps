"use client";

import {
  ChevronsDown,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { useTeams } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import {
  FilterBar,
  FilterDivider,
  FilterGroup,
  FilterSearch,
} from "@/components/ui/filter-bar";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { useMinWidth } from "@/components/ui/use-min-width";
import { Permission } from "@/lib/api/contracts";
import type {
  IncidentPart,
  IncidentPartCount,
  IncidentState,
} from "@/lib/api/contracts";

import { IncidentBoard, IncidentCards } from "./incident-board";
import {
  FilterChip,
  useIncidentFilters,
  useReplaceParams,
} from "./incident-filters";
import { useIncidentList, useIncidentParts } from "./incident-queries";
import { DeclareIncident } from "./incidents-view";
import { LiveStatus } from "./live-status";
import { SEVERITY_LEVELS, SeverityGlyph } from "./severity";

/**
 * The Incidents page as a member reads it: their teams' incidents, organised
 * by their own part in each — what needs them, what they are investigating,
 * what they have completed — then everything active, and what is resolved.
 *
 * The part is the page's first choice, held in its URL (`?view=`, needs-you
 * when absent) like the filters beneath it: search, their own teams, and
 * severity, each pill counting what its part holds. Nothing here acts on an
 * incident: every row opens it, where starting, posting, and completing live.
 *
 * The organization-wide figures and the service and team pickers are the
 * Admin's page; a member's teams are the only teams they need.
 */

type View = IncidentPart | "active" | "resolved";

const VIEWS: readonly {
  value: View;
  label: string;
  note: string;
  tone: string;
}[] = [
  {
    value: "needs-you",
    label: "Needs you",
    note: "yours to start, not joined yet",
    tone: "text-warning-text",
  },
  {
    value: "investigating",
    label: "You're investigating",
    note: "post updates, then complete",
    tone: "text-status-investigating-text",
  },
  {
    value: "completed",
    label: "You've completed",
    note: "the Admin resolves",
    tone: "text-status-resolved-text",
  },
  {
    value: "active",
    label: "All active",
    note: "everything on your teams",
    tone: "text-fg-muted",
  },
  {
    value: "resolved",
    label: "Resolved",
    note: "your teams' history",
    tone: "text-fg-muted",
  },
];

const isView = (value: string): value is View =>
  VIEWS.some((each) => each.value === value);

/** What each list says when it is empty, unfiltered. */
const EMPTY: Record<View, { title: string; body: string }> = {
  "needs-you": {
    title: "Nothing needs you",
    body: "Every incident on your teams has someone on it, or is waiting to be resolved.",
  },
  investigating: {
    title: "You're not investigating anything",
    body: "Incidents you start appear here until you complete your part.",
  },
  completed: {
    title: "Nothing completed and still open",
    body: "Incidents you've finished on appear here until the Admin resolves them.",
  },
  active: {
    title: "No active incidents",
    body: "Nothing on your teams needs a response right now.",
  },
  resolved: {
    title: "No resolved incidents",
    body: "Your teams' incidents appear here once resolved, most recent first.",
  },
};

/** Beneath a list: what its part means, so the tab is never a guess. */
const FOOTNOTE: Partial<Record<View, string>> = {
  "needs-you":
    "Incidents your teams are responsible for that you haven't joined, while someone is still needed.",
  investigating: "Post updates as you work, and complete your part when you're done.",
  completed: "The Admin resolves an incident once no one is still investigating.",
};

/** "Payments", "Payments and Risk", "A, B, and C". */
const nameList = (names: readonly string[]) =>
  names.length <= 2
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;

/** The five parts, each with its count and what it means. */
function PartTabs({
  view,
  counts,
  onChange,
}: {
  view: View;
  counts: Partial<Record<View, number>>;
  onChange: (next: View) => void;
}) {
  return (
    // On a phone, one row that scrolls sideways, each part its name and count.
    <div
      role="group"
      aria-label="Your part"
      className="scrollbar-thin flex gap-2 overflow-x-auto rounded-lg border border-line-subtle bg-linear-to-b from-band-top to-band-bottom p-2.5 sm:flex-wrap sm:gap-3 sm:overflow-visible sm:p-4"
    >
      {VIEWS.map((each) => {
        const pressed = view === each.value;
        const count = counts[each.value];

        return (
          <button
            key={each.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(each.value)}
            className={cx(
              "flex shrink-0 flex-col items-start gap-0.5 rounded-full border px-3.5 py-2 text-left whitespace-nowrap transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:min-w-38 sm:rounded-lg sm:px-4 sm:py-3 sm:whitespace-normal",
              pressed
                ? "border-status-resolved-line bg-status-resolved-subtle"
                : "border-line bg-surface hover:bg-hover",
            )}
          >
            <span className="text-sm font-semibold text-fg">
              {each.label}
              {count !== undefined && (
                <span className={cx("numeric ml-1.5", each.tone)}>{count}</span>
              )}
            </span>
            <span className="hidden text-xs text-fg-muted sm:block">{each.note}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Search, the member's own teams, and severity, in a bar of their own beneath
 * the parts. Each pill counts what the chosen part holds, when it is one the
 * counts cover; a choice applies at once, the search when it is submitted.
 */
function MemberFilterBar({
  count,
  active,
  error,
}: {
  /** The chosen part's counts; none for the resolved list. */
  count?: IncidentPartCount;
  /** Whether any filter applies, which offers clearing them all. */
  active: boolean;
  error: unknown;
}) {
  const organization = useOrganization();
  const searchParams = useSearchParams();
  const teams = useTeams(organization.id);
  const replace = useReplaceParams();

  const q = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [shownQ, setShownQ] = useState(q);

  // The URL changed from elsewhere — cleared, or a link followed.
  if (q !== shownQ) {
    setShownQ(q);
    setSearch(q);
  }

  const set = (name: "q" | "severity" | "team", value: string) =>
    replace((params) => {
      if (value) params.set(name, value);
      else params.delete(name);
    });


  const severity = searchParams.get("severity") ?? "";
  const team = searchParams.get("team") ?? "";
  const ofTeam = (teamId: string) =>
    count?.byTeam.find((each) => each.teamId === teamId)?.count ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorAlert error={error} /> : null}
      <FilterBar
        label="Filter incidents"
        end={
          active && (
            <Button
              icon={X}
              variant="quiet"
              size="sm"
              onClick={() =>
                replace((params) =>
                  ["q", "severity", "team"].forEach((name) => params.delete(name)),
                )
              }
            >
              Clear filters
            </Button>
          )
        }
      >
        <FilterSearch
          id="incident-search"
          label="Search"
          value={search}
          onChange={setSearch}
          onSubmit={() => set("q", search.trim())}
          placeholder="Title, or INC-42"
          maxLength={200}
        />
        <FilterDivider />
        {teams.data && teams.data.length > 1 && (
          <FilterGroup label="Team">
            <FilterChip
              pressed={team === ""}
              onClick={() => set("team", "")}
              count={count?.total}
            >
              All your teams
            </FilterChip>
            {teams.data.map((each) => (
              <FilterChip
                key={each.id}
                pressed={team === each.id}
                onClick={() => set("team", team === each.id ? "" : each.id)}
                count={count && ofTeam(each.id)}
              >
                {each.name}
              </FilterChip>
            ))}
          </FilterGroup>
        )}
        <FilterGroup label="Severity">
          <FilterChip
            pressed={severity === ""}
            onClick={() => set("severity", "")}
            count={count?.total}
          >
            Any
          </FilterChip>
          {SEVERITY_LEVELS.map((level) => (
            <FilterChip
              key={level.value}
              pressed={severity === level.value}
              onClick={() =>
                set("severity", severity === level.value ? "" : level.value)
              }
              count={count?.bySeverity[level.value]}
            >
              <SeverityGlyph severity={level.value} />
              {/* The space is for the name ("SEV1 Critical"); flex drops it. */}
              {level.value} <span className="sr-only">{level.label}</span>
            </FilterChip>
          ))}
        </FilterGroup>
      </FilterBar>
    </div>
  );
}

export function MemberIncidentsView() {
  const organization = useOrganization();
  const searchParams = useSearchParams();
  const replace = useReplaceParams();
  const teams = useTeams(organization.id);
  const filters = useIncidentFilters();
  const parts = useIncidentParts(organization.id);
  // A phone gets the list as cards: a table of six columns has no room there.
  const wide = useMinWidth();

  // Someone who raises incidents rather than working them — a Reporter —
  // has nothing waiting on them: their page opens on what is active.
  const works = useCan(Permission.RESPONSES_WORK);
  const asked = searchParams.get("view");
  const view: View =
    asked && isView(asked) ? asked : works ? "needs-you" : "active";
  const state: IncidentState = view === "resolved" ? "resolved" : "active";
  const part = view === "active" || view === "resolved" ? undefined : view;

  // A member's page offers no service or response filter, and no period:
  // taken out of the URL like any other that cannot apply here.
  const filtersHere = {
    ...(filters.filters.q && { q: filters.filters.q }),
    ...(filters.filters.severity && { severity: filters.filters.severity }),
    ...(filters.filters.teamId && { teamId: filters.filters.teamId }),
  };
  const list = useIncidentList(
    organization.id,
    state,
    undefined,
    { ...filtersHere, ...(part && { part }) },
    !filters.pending,
    true,
  );

  const drop = [
    ...filters.invalid,
    ...["service", "response", "from", "to"].filter((name) => searchParams.has(name)),
    ...(asked !== null && !isView(asked) ? ["view"] : []),
  ].join(",");

  useEffect(() => {
    if (drop) replace((params) => drop.split(",").forEach((name) => params.delete(name)));
    // `replace` is rebuilt every render; which parameters to drop is what
    // decides whether anything happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop]);

  const counts: Partial<Record<View, number>> = parts.data
    ? {
        "needs-you": parts.data["needs-you"].total,
        investigating: parts.data.investigating.total,
        completed: parts.data.completed.total,
        active: parts.data.active.total,
      }
    : {};
  const filtered = Object.keys(filtersHere).length > 0;
  const yourTeamIds = new Set(teams.data?.map(({ id }) => id));
  const teamNames = teams.data?.map(({ name }) => name) ?? [];
  const chosen = VIEWS.find((each) => each.value === view)!;

  const incidents = list.data?.pages.flatMap((page) => page.items);

  return (
    <>
      <PageHeader
        width="full"
        title="Incidents"
        description={
          !works
            ? "The incidents you declared, and where each one stands."
            : !teams.data
            ? "Your teams' incidents, and where your part in each stands."
            : teamNames.length === 0
              ? "You're on no team yet, so nothing waits on you. Incidents you responded to are still here."
              : `Incidents on your ${teamNames.length === 1 ? "team" : "teams"}, ${nameList(teamNames)}, and where your part in each stands.`
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <LiveStatus updatedAt={list.dataUpdatedAt} failed={list.isRefetchError} />
            <DeclareIncident />
          </div>
        }
      />
      <PageBody width="full">
        <div className="flex flex-col gap-4">
          {parts.isError && <ErrorAlert error={parts.error} />}
          <PartTabs
            view={view}
            counts={counts}
            onChange={(next) =>
              replace((params) => {
                if (next === "needs-you") params.delete("view");
                else params.set("view", next);
              })
            }
          />
          <MemberFilterBar
            count={view === "resolved" ? undefined : parts.data?.[part ?? "active"]}
            active={filtered}
            error={filters.error ?? teams.error}
          />
          <section aria-label={chosen.label} className="mt-2 flex flex-col gap-3">
            {list.isError ? (
              <ErrorAlert error={list.error} />
            ) : !incidents ? (
              <Spinner label="Loading incidents…" />
            ) : incidents.length === 0 ? (
              filtered ? (
                <EmptyNote title="Nothing matches">
                  Nothing in {chosen.label} matches the filters. Clear them to see
                  everything.
                </EmptyNote>
              ) : (
                <EmptyNote title={EMPTY[view].title}>{EMPTY[view].body}</EmptyNote>
              )
            ) : (
              <>
                {wide ? (
                  <IncidentBoard
                    incidents={incidents}
                    state={state}
                    label={chosen.label}
                    perspective="member"
                    yourTeamIds={yourTeamIds}
                  />
                ) : (
                  <IncidentCards
                    incidents={incidents}
                    label={chosen.label}
                    yourTeamIds={yourTeamIds}
                  />
                )}
                {list.hasNextPage && (
                  <div>
                    <Button icon={ChevronsDown}
                      variant="secondary"
                      size="sm"
                      disabled={list.isFetchingNextPage}
                      onClick={() => void list.fetchNextPage()}
                    >
                      {list.isFetchingNextPage ? "Loading…" : "Show more"}
                    </Button>
                  </div>
                )}
              </>
            )}
            {FOOTNOTE[view] && incidents && incidents.length > 0 && (
              <p className="text-xs text-fg-muted">{FOOTNOTE[view]}</p>
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}
