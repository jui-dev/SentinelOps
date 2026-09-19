"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { EmptyNote } from "@/components/ui/empty-state";
import { quietLinkClasses } from "@/components/ui/link";
import { Section } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import type { IncidentFilters, IncidentState } from "@/lib/api/contracts";

import { incidentsHref, useIncidentList } from "./incident-queries";
import { IncidentTable } from "./incident-table";

/** How many resolved incidents a service or team page shows. */
export const RECENTLY_RESOLVED = 5;

/**
 * What a service's or team's incidents are narrowed by: the filter the API
 * takes, and the same one as the Incidents page's URL names it, by slug —
 * so "View all" opens that page already filtered.
 */
export type IncidentScope =
  | { serviceId: string; param: { service: string } }
  | { teamId: string; param: { team: string } };

const filtersOf = (scope: IncidentScope): IncidentFilters =>
  "serviceId" in scope
    ? { serviceId: scope.serviceId }
    : { teamId: scope.teamId };

/** The Incidents page, filtered to the same service or team. */
const viewAllHref = (orgSlug: string, scope: IncidentScope) =>
  `${incidentsHref(orgSlug)}?${new URLSearchParams(scope.param)}`;

/** A link with a trailing arrow, for "go to the full list". */
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

/** A service's or team's active incidents, or its recently resolved ones. */
function ScopedList({
  scope,
  state,
  empty,
}: {
  scope: IncidentScope;
  state: IncidentState;
  empty: ReactNode;
}) {
  const organization = useOrganization();
  const list = useIncidentList(
    organization.id,
    state,
    undefined,
    filtersOf(scope),
  );
  const active = state === "active";

  if (list.isError) return <ErrorAlert error={list.error} />;
  if (!list.data) {
    return (
      <Spinner
        label={active ? "Loading active incidents…" : "Loading resolved incidents…"}
      />
    );
  }

  const first = list.data.pages[0]?.items ?? [];
  // Every active incident on the first page — rarely more than one — and
  // only the most recent few resolved. The rest are one link away, on the
  // Incidents page filtered the same way.
  const shown = active ? first : first.slice(0, RECENTLY_RESOLVED);

  if (shown.length === 0) return empty;

  return (
    <IncidentTable
      incidents={shown}
      state={state}
      label={active ? "Active incidents" : "Recently resolved incidents"}
    />
  );
}

/**
 * The incidents of one service, or one team: those active now, then the
 * most recently resolved — read through the Incidents page's own lists,
 * filtered, and linking to that page filtered the same way. `description`
 * says which relationship this is, since a team's incidents are those it is
 * responsible for, not those of the services it owns.
 */
export function RelatedIncidents({
  scope,
  description,
}: {
  scope: IncidentScope;
  description: string;
}) {
  const organization = useOrganization();

  return (
    <Section
      id="incidents"
      title="Incidents"
      description={description}
      spacing="loose"
      actions={
        <OnwardLink href={viewAllHref(organization.slug, scope)}>
          View all in Incidents
        </OnwardLink>
      }
    >
      <Section id="active-incidents" title="Active" level={3}>
        <ScopedList
          scope={scope}
          state="active"
          empty={
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
          }
        />
      </Section>
      <Section id="resolved-incidents" title="Recently resolved" level={3}>
        <ScopedList
          scope={scope}
          state="resolved"
          empty={
            <EmptyNote title="None resolved yet">
              Resolved incidents appear here, most recent first.
            </EmptyNote>
          }
        />
      </Section>
    </Section>
  );
}
