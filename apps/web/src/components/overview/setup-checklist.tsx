"use client";

import { Check, ListChecks, Plus, Siren, UserPlus } from "lucide-react";

import {
  incidentsHref,
  useIncidentList,
} from "@/components/incidents/incident-queries";
import { membersHref } from "@/components/organizations/member-paths";
import { useMemberships } from "@/components/organizations/membership-list";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { servicesHref } from "@/components/services/service-scope";
import { teamsHref, useTeams } from "@/components/teams/team-scope";

import { cx } from "@/components/ui/cx";
import { Permission } from "@/lib/api/contracts";

import { OverviewPanel } from "./overview-panel";
import { ButtonLink } from "@/components/ui/button-link";
import type { ButtonIcon } from "@/components/ui/button";

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** Where an organization stands on being set up, read from what it has. */
export interface SetupFacts {
  teams: number;
  /** Members other than the reader. */
  others: number;
  /** Teams with at least one member placed on them. */
  staffedTeams: number;
  /** Services owned by a team, summed over the teams. */
  services: number;
  hasIncident: boolean;
}

interface SetupStep {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  /** Why the step cannot be taken yet; absent when it can. */
  blockedBy?: string;
  action: { label: string; href: string; icon: ButtonIcon };
}

/**
 * The steps, in the order the data model demands: a service needs an owner
 * team, members respond through the teams they are on, and an incident is
 * declared against a service.
 */
export const setupSteps = (facts: SetupFacts, slug: string): SetupStep[] => {
  const hasTeam = facts.teams > 0;
  const hasService = facts.services > 0;

  return [
    {
      id: "team",
      title: "Create a team",
      detail: hasTeam
        ? plural(facts.teams, "team")
        : "Teams own services and respond to their incidents.",
      done: hasTeam,
      action: { label: "Create a team", icon: Plus, href: teamsHref(slug) },
    },
    {
      id: "members",
      title: "Add members and place them on teams",
      detail:
        facts.others === 0
          ? "Add the people who respond, then place them on teams."
          : facts.staffedTeams === 0
            ? `${plural(facts.others, "member")} added, none on a team yet.`
            : `${plural(facts.others, "member")} added, ${plural(facts.staffedTeams, "team")} staffed.`,
      done: facts.others > 0 && facts.staffedTeams > 0,
      blockedBy: hasTeam ? undefined : "Needs a team first",
      action: { label: "Add members", icon: UserPlus, href: membersHref(slug) },
    },
    {
      id: "service",
      title: "Register a service and choose its owner team",
      detail: hasService
        ? `${plural(facts.services, "service")} owned by teams`
        : "Its owner team responds when it has an incident.",
      done: hasService,
      blockedBy: hasTeam ? undefined : "Needs a team first",
      action: { label: "Register a service", icon: Plus, href: servicesHref(slug) },
    },
    {
      id: "incident",
      title: "Declare your first incident",
      detail: facts.hasIncident
        ? "Incidents are being tracked."
        : "Declare one against a service; its owner team takes it from there.",
      done: facts.hasIncident,
      blockedBy: hasService ? undefined : "Needs a service first",
      action: { label: "Declare an incident", icon: Siren, href: incidentsHref(slug) },
    },
  ];
};

function StepMarker({ index, done }: { index: number; done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold",
        done
          ? "border-success-line bg-success-subtle text-success-text"
          : "border-line-strong bg-surface text-fg-muted",
      )}
    >
      {done ? <Check strokeWidth={2.5} className="size-3.5" /> : index + 1}
    </span>
  );
}

function Checklist({ facts }: { facts: SetupFacts }) {
  const organization = useOrganization();
  const steps = setupSteps(facts, organization.slug);
  const done = steps.filter((step) => step.done).length;

  // Finished for good: guidance that has nothing left to say goes.
  if (done === steps.length) return null;

  const next = steps.find((step) => !step.done && !step.blockedBy);

  return (
    <OverviewPanel
      id="setup"
      title={`Set up ${organization.name}`}
      icon={ListChecks}
      family="setup"
      description="What to configure first, in the order each part depends on the last."
      actions={
        <p className="numeric text-sm text-fg-muted">
          {done} of {steps.length} done
        </p>
      }
    >
      <ol aria-label="Setup steps" className="flex flex-col">
        {steps.map((step, index) => (
          <li
            key={step.id}
            aria-current={step === next ? "step" : undefined}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-subtle px-4 py-3 first:border-t-0 sm:px-5"
          >
            <StepMarker index={index} done={step.done} />
            <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
              <p
                className={cx(
                  "text-sm font-medium",
                  step.done ? "text-fg-muted" : "text-fg",
                )}
              >
                {step.title}
                {step.done && <span className="sr-only"> (done)</span>}
              </p>
              <p className="text-sm text-fg-muted">{step.detail}</p>
            </div>
            {!step.done &&
              (step.blockedBy ? (
                <p className="text-sm text-fg-subtle">{step.blockedBy}</p>
              ) : (
                <ButtonLink
                  href={step.action.href}
                  variant={step === next ? "primary" : "add"}
                  icon={step.action.icon}
                >
                  {step.action.label}
                </ButtonLink>
              ))}
          </li>
        ))}
      </ol>
    </OverviewPanel>
  );
}

/** Reads the facts; shows nothing until every one is known. */
function SetupChecklistReader() {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const memberships = useMemberships(organization.id);
  // The Overview's own key for the active list: one cache, no second request.
  const active = useIncidentList(organization.id, "active");
  const resolved = useIncidentList(organization.id, "resolved");

  // Guidance, not data: while loading or after a failure it simply waits,
  // so the Overview never flickers or shows an error on its behalf.
  if (!teams.data || !memberships.data || !active.data || !resolved.data) {
    return null;
  }

  const firstItems = (list: typeof active) =>
    list.data?.pages[0]?.items.length ?? 0;

  return (
    <Checklist
      facts={{
        teams: teams.data.length,
        others: Math.max(memberships.data.length - 1, 0),
        staffedTeams: teams.data.filter((team) => team.memberCount > 0).length,
        services: teams.data.reduce((sum, team) => sum + team.serviceCount, 0),
        hasIncident: firstItems(active) + firstItems(resolved) > 0,
      }}
    />
  );
}

/**
 * "Set up your organization": the first-run guide on the Overview.
 *
 * Offered only to whoever configures the organization, and asked for
 * nothing otherwise. Each step ticks itself from what the organization has;
 * once all are done it is gone. It adds no request of its own beyond the
 * lists the workspace already reads.
 */
export function SetupChecklist() {
  const canConfigure = useCan(Permission.TEAMS_MANAGE);

  return canConfigure ? <SetupChecklistReader /> : null;
}
