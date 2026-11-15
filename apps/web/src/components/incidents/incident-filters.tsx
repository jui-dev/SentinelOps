"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { useServices } from "@/components/services/service-scope";
import { useTeams } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  FilterBar,
  FilterDivider,
  FilterGroup,
  FilterOption,
  FilterSearch,
  FilterSelect,
} from "@/components/ui/filter-bar";
import type {
  IncidentFilters,
  IncidentResponseFilter,
  IncidentSeverity,
} from "@/lib/api/contracts";

import { SEVERITY_LEVELS, SeverityGlyph } from "./severity";

/**
 * The Incidents page's filters, held in its URL so a filtered list can be
 * linked to, shared, and returned to: `q`, `severity`, `response`, the
 * service by slug, and the team by id — `?service=payment-api&team=0199…`
 * — as a team's own
 * page is addressed. The API takes ids, so a service slug is turned into one
 * from the organization's services, and a team id is checked against its
 * teams.
 */
const PARAMS = ["q", "severity", "response", "service", "team"] as const;

const isSeverity = (value: string): value is IncidentSeverity =>
  SEVERITY_LEVELS.some((level) => level.value === value);

/** Where the response stands, as the chips offer it. */
export const RESPONSE_FILTERS: readonly {
  value: IncidentResponseFilter;
  label: string;
}[] = [
  { value: "unclaimed", label: "Needs a responder" },
  { value: "ready", label: "Ready to resolve" },
];

const isResponse = (value: string): value is IncidentResponseFilter =>
  RESPONSE_FILTERS.some((each) => each.value === value);

/**
 * The filters the URL asks for, as the API takes them.
 *
 * `pending` while a service or team named in the URL cannot be looked up yet:
 * the lists wait rather than show everything for a moment. `invalid` names
 * the parameters that can never apply — a severity that is not one, a
 * service or team this organization does not have — which the page takes out
 * of its URL, as it does a period the API would refuse.
 */
export const useIncidentFilters = () => {
  const organization = useOrganization();
  const searchParams = useSearchParams();
  const services = useServices(organization.id);
  const teams = useTeams(organization.id);

  const q = searchParams.get("q")?.trim() || undefined;
  const severity = searchParams.get("severity") ?? undefined;
  const response = searchParams.get("response") ?? undefined;
  const serviceSlug = searchParams.get("service") ?? undefined;
  const teamId = searchParams.get("team") ?? undefined;

  const service = serviceSlug
    ? services.data?.find((each) => each.slug === serviceSlug)
    : undefined;
  const team = teamId
    ? teams.data?.find((each) => each.id === teamId)
    : undefined;

  const invalid = [
    ...(severity !== undefined && !isSeverity(severity) ? ["severity"] : []),
    ...(response !== undefined && !isResponse(response) ? ["response"] : []),
    ...(serviceSlug && services.data && !service ? ["service"] : []),
    ...(teamId && teams.data && !team ? ["team"] : []),
  ];

  const filters: IncidentFilters = {
    ...(q && { q }),
    ...(severity && isSeverity(severity) && { severity }),
    ...(response && isResponse(response) && { response }),
    ...(service && { serviceId: service.id }),
    ...(team && { teamId: team.id }),
  };

  return {
    filters,
    active: Object.keys(filters).length > 0,
    pending:
      (!!serviceSlug && !services.data) || (!!teamId && !teams.data),
    invalid,
    error: services.error ?? teams.error,
  };
};

/**
 * Changes the page's URL in place: its other parameters — the period
 * included — are kept, and the history is not extended by every choice.
 */
export const useReplaceParams = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (change: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams);

    change(params);

    const query = params.toString();

    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };
};

/**
 * One filter chip: pressed when it applies. Shared with Incident history and
 * a member's incidents. An option in a `FilterGroup`'s track.
 */
export const FilterChip = FilterOption;

/**
 * Search, severity, where the response stands, service, and team, over the
 * lists — in the one filter bar every list shares (ui/filter-bar.tsx).
 * Severity and response are chips, one of each at a time; a choice applies
 * at once, and the search when it is submitted, so a list is not asked for
 * at every keystroke. Every service is offered, archived ones too — they
 * keep their incidents.
 */
export function IncidentFilterBar({
  active,
  error,
}: {
  /** Whether any filter applies, which offers clearing them all. */
  active: boolean;
  /** Why the services or teams offered could not be loaded. */
  error: unknown;
}) {
  const organization = useOrganization();
  const searchParams = useSearchParams();
  const services = useServices(organization.id);
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

  const set = (name: (typeof PARAMS)[number], value: string) =>
    replace((params) => {
      if (value) params.set(name, value);
      else params.delete(name);
    });


  const severity = searchParams.get("severity") ?? "";
  const response = searchParams.get("response") ?? "";

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
                replace((params) => PARAMS.forEach((name) => params.delete(name)))
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
        <FilterGroup label="Severity">
          <FilterOption pressed={severity === ""} onClick={() => set("severity", "")}>
            Any
          </FilterOption>
          {SEVERITY_LEVELS.map((level) => (
            <FilterOption
              key={level.value}
              pressed={severity === level.value}
              onClick={() =>
                set("severity", severity === level.value ? "" : level.value)
              }
            >
              <SeverityGlyph severity={level.value} />
              {/* The space is for the name ("SEV1 Critical"); flex drops it. */}
              {level.value}{" "}
              <span className="sr-only">{level.label}</span>
            </FilterOption>
          ))}
        </FilterGroup>
        <FilterGroup label="Response">
          {RESPONSE_FILTERS.map((each) => (
            <FilterOption
              key={each.value}
              pressed={response === each.value}
              onClick={() =>
                set("response", response === each.value ? "" : each.value)
              }
            >
              {each.label}
            </FilterOption>
          ))}
        </FilterGroup>
        <FilterSelect
          label="Service"
          value={services.data ? (searchParams.get("service") ?? "") : ""}
          onChange={(event) => set("service", event.target.value)}
          disabled={!services.data}
        >
          <option value="">Any service</option>
          {services.data?.map((service) => (
            <option key={service.id} value={service.slug}>
              {service.archivedAt ? `${service.name} (archived)` : service.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Responsible team"
          value={teams.data ? (searchParams.get("team") ?? "") : ""}
          onChange={(event) => set("team", event.target.value)}
          disabled={!teams.data}
        >
          <option value="">Any team</option>
          {teams.data?.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </FilterSelect>
      </FilterBar>
    </div>
  );
}
