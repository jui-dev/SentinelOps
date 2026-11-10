"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { useServices } from "@/components/services/service-scope";
import { useTeams } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Select } from "@/components/ui/select";
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

/** One filter chip: pressed when it applies. */
function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        pressed
          ? "border-accent-rim bg-accent text-on-accent"
          : "border-line bg-surface text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Search, severity, where the response stands, service, and team, over the
 * lists — in a band of the rail's own ground, as the other lists' are.
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

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    set("q", search.trim());
  };

  const severity = searchParams.get("severity") ?? "";
  const response = searchParams.get("response") ?? "";

  return (
    <div
      role="search"
      aria-label="Filter incidents"
      className="flex flex-col gap-3 rounded-xl border border-line-subtle bg-linear-to-b from-rail-top to-rail-mid p-3"
    >
      {error ? <ErrorAlert error={error} /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <form
          onSubmit={onSearch}
          className="flex w-full items-center gap-2 sm:w-auto sm:flex-1 sm:basis-72"
        >
          <div className="relative min-w-0 flex-1">
            <label htmlFor="incident-search" className="sr-only">
              Search
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
            />
            <input
              id="incident-search"
              name="q"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title, or a number such as INC-42"
              maxLength={200}
              autoComplete="off"
              className="h-9 w-full rounded-md border border-line-control bg-field pr-3 pl-9 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <div className="w-full sm:w-48">
          <Select
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
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select
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
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Severity" className="flex flex-wrap gap-1.5">
          <Chip pressed={severity === ""} onClick={() => set("severity", "")}>
            Any severity
          </Chip>
          {SEVERITY_LEVELS.map((level) => (
            <Chip
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
            </Chip>
          ))}
        </div>
        <span aria-hidden="true" className="hidden h-5 w-px bg-line sm:block" />
        <div role="group" aria-label="Response" className="flex flex-wrap gap-1.5">
          {RESPONSE_FILTERS.map((each) => (
            <Chip
              key={each.value}
              pressed={response === each.value}
              onClick={() =>
                set("response", response === each.value ? "" : each.value)
              }
            >
              {each.label}
            </Chip>
          ))}
        </div>
        {active && (
          <span className="ml-auto">
            <Button
              variant="quiet"
              size="sm"
              onClick={() =>
                replace((params) => PARAMS.forEach((name) => params.delete(name)))
              }
            >
              Clear filters
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
