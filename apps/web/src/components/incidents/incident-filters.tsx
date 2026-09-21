"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { useServices } from "@/components/services/service-scope";
import { useTeams } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { IncidentFilters, IncidentSeverity } from "@/lib/api/contracts";

import { SEVERITY_LEVELS } from "./severity";

/**
 * The Incidents page's filters, held in its URL so a filtered list can be
 * linked to, shared, and returned to: `q`, `severity`, the service by slug,
 * and the team by id — `?service=payment-api&team=0199…` — as a team's own
 * page is addressed. The API takes ids, so a service slug is turned into one
 * from the organization's services, and a team id is checked against its
 * teams.
 */
const PARAMS = ["q", "severity", "service", "team"] as const;

const isSeverity = (value: string): value is IncidentSeverity =>
  SEVERITY_LEVELS.some((level) => level.value === value);

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
    ...(serviceSlug && services.data && !service ? ["service"] : []),
    ...(teamId && teams.data && !team ? ["team"] : []),
  ];

  const filters: IncidentFilters = {
    ...(q && { q }),
    ...(severity && isSeverity(severity) && { severity }),
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
 * Search, severity, service, and team, over both lists. A choice applies at
 * once; the search applies when it is submitted, so a list is not asked for
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

  return (
    <div
      role="search"
      aria-label="Filter incidents"
      className="flex flex-col gap-3"
    >
      {error ? <ErrorAlert error={error} /> : null}
      <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <form onSubmit={onSearch} className="flex items-end gap-2 sm:col-span-2 xl:col-span-1">
          <div className="min-w-0 flex-1">
            <Field
              label="Search"
              name="q"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Title, or a number such as INC-42"
              maxLength={200}
              autoComplete="off"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Select
          label="Severity"
          value={searchParams.get("severity") ?? ""}
          onChange={(event) => set("severity", event.target.value)}
        >
          <option value="">Any severity</option>
          {SEVERITY_LEVELS.map((level) => (
            <option key={level.value} value={level.value}>
              {level.value} · {level.label}
            </option>
          ))}
        </Select>
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
        {active && (
          <Button
            variant="quiet"
            onClick={() =>
              replace((params) => PARAMS.forEach((name) => params.delete(name)))
            }
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
