"use client";

import { ArrowRight, Boxes, LayoutDashboard, Siren, Users } from "lucide-react";

import { howItWorksHref } from "@/components/app/shell-utilities";
import { incidentsHref, useHasAnyIncident } from "@/components/incidents/incident-queries";
import { OperationsOverview } from "@/components/overview/operations-overview";
import { servicesHref, useServices } from "@/components/services/service-scope";
import { teamsHref, useTeams } from "@/components/teams/team-scope";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyNote } from "@/components/ui/empty-state";
import { FirstRun, setupPath } from "@/components/ui/first-run";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { Permission } from "@/lib/api/contracts";

import { useCan, useOrganization } from "./organization-scope";

/**
 * The Overview of an organization that has never had an incident: in place
 * of sections with nothing to say, the next step of setting it up — a
 * team, then a service, then the first incident — and the way to it.
 */
function OverviewFirstRun() {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const services = useServices(organization.id);
  const canManageTeams = useCan(Permission.TEAMS_MANAGE);
  const canManageServices = useCan(Permission.SERVICES_MANAGE);

  if (!teams.data || !services.data) return <Spinner label="Loading…" />;

  const has = {
    teams: teams.data.length > 0,
    services: services.data.some((service) => !service.archivedAt),
  };
  const next = !has.teams ? "teams" : !has.services ? "services" : "incidents";
  const step = {
    teams: {
      title: "Start with a team",
      text: "Teams are the people who respond — each owns services, and its members work their incidents.",
      href: teamsHref(organization.slug),
      label: "Go to Teams",
      icon: Users,
      allowed: canManageTeams,
      note: "The Admin sets the organization up, starting with its teams.",
    },
    services: {
      title: "Next, add a service",
      text: "Services are the systems you run. Every incident is declared against one, and the team that owns it responds.",
      href: servicesHref(organization.slug),
      label: "Go to Services",
      icon: Boxes,
      allowed: canManageServices,
      note: "The Admin adds services next.",
    },
    incidents: {
      title: "Ready for the first incident",
      text: "Teams and services are set up. When something goes wrong, declare it on Incidents — then this page shows what is wrong now, what waits on you, and how the response is going.",
      href: incidentsHref(organization.slug),
      label: "Go to Incidents",
      icon: Siren,
      allowed: true,
      note: undefined,
    },
  }[next];

  return (
    <FirstRun
      icon={LayoutDashboard}
      title={step.title}
      action={
        step.allowed && (
          <ButtonLink
            href={step.href}
            variant="primary"
            icon={step.icon}
            trailingIcon={ArrowRight}
          >
            {step.label}
          </ButtonLink>
        )
      }
      note={step.allowed ? undefined : step.note}
      learn={{ href: howItWorksHref(organization.slug), label: "How SentinelOps works" }}
      steps={setupPath(next, has)}
      preview={false}
    >
      <p>{step.text}</p>
    </FirstRun>
  );
}

/**
 * The organization's front page: its operations — or, before its first
 * incident, the next step of setting it up. Every role reads incidents
 * today; should one not, the page says why it is empty rather than being so.
 */
export function OrganizationOverview() {
  const organization = useOrganization();
  const canReadIncidents = useCan(Permission.INCIDENTS_READ);
  const hasAny = useHasAnyIncident(organization.id, canReadIncidents);

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          canReadIncidents
            ? "Your organization's operational state at a glance."
            : undefined
        }
      />
      <PageBody>
        {!canReadIncidents ? (
          <EmptyNote title="No operations to show">
            Your role does not include reading incidents.
          </EmptyNote>
        ) : hasAny === false ? (
          <OverviewFirstRun />
        ) : (
          <OperationsOverview />
        )}
      </PageBody>
    </>
  );
}
