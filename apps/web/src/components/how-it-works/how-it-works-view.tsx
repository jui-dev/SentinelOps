"use client";

import { ArrowRight, Bell, Eye, Grid3x3, Lock, Route } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { INSTRUMENT } from "@/components/overview/analytical-view-header";
import { OverviewPanel, SECTION_FAMILIES } from "@/components/overview/overview-panel";
import { roleMeta } from "@/components/roles/role-meta";
import { StatusMark } from "@/components/incidents/severity";
import { cx } from "@/components/ui/cx";
import { PageBody, PageHeader } from "@/components/ui/page";
import type { Role } from "@/lib/api/contracts";

import {
  ABILITIES,
  ROLES_IN_ORDER,
  STEPS,
  WHERE_IT_SHOWS,
} from "./how-it-works-content";
import type { Part, Step, StepLink } from "./how-it-works-content";

/**
 * A role as a chip in its colour: solid where it leads, dashed where it
 * can help.
 */
function RoleChip({ role, dashed = false }: { role: Role; dashed?: boolean }) {
  const meta = roleMeta(role);

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        meta.tone.text,
        meta.tone.line,
        dashed ? "border-dashed" : meta.tone.subtle,
      )}
    >
      {meta.label}
    </span>
  );
}

/** "Incident Manager or Admin": who holds what the reader does not. */
const holders = (roles: readonly Role[]) => {
  const labels = roles.map((role) => roleMeta(role).label);

  return labels.length < 2
    ? labels.join("")
    : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
};

/**
 * A page the reader may open, as a link; one they may not, as whose it is
 * — the page explains everything to everyone, but only opens what the
 * reader's role can use.
 */
function PageLink({ link }: { link: StepLink }) {
  const organization = useOrganization();
  const allowed = organization.membership.permissions.includes(link.requires);

  if (!allowed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line px-2.5 py-1 text-xs text-fg-subtle">
        <Lock aria-hidden="true" strokeWidth={1.75} className="size-3" />
        {link.label}
        <span aria-hidden="true">·</span>
        <span>
          <span className="sr-only">opened by </span>
          {holders(link.roles)}
        </span>
      </span>
    );
  }

  return (
    <Link
      href={link.href(organization.slug)}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-sm font-medium text-accent-text transition-colors duration-(--duration-fast) hover:border-line-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {link.label}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

const PARTS: Record<Part, { label: string; mark: string }> = {
  lead: { label: "Leads", mark: "size-2 rounded-full bg-current" },
  help: { label: "Can help", mark: "size-2 rounded-full border-2 border-current" },
  none: { label: "No part", mark: "" },
};

/** The journey at a glance: every step, who leads it, who can help. */
function Journey() {
  return (
    <OverviewPanel
      id="journey"
      title="An incident, start to finish"
      icon={Route}
      family="investigating"
      label={<Pill>{STEPS.length} steps</Pill>}
      description="Every incident goes through the same steps. Each is led by one role; others can help."
      actions={
        <span className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="inline-flex items-center rounded-full border border-line bg-surface px-2 py-0.5 font-semibold text-fg">
            Leads
          </span>
          <span className="inline-flex items-center rounded-full border border-dashed border-line-strong px-2 py-0.5 font-semibold text-fg">
            Can help
          </span>
        </span>
      }
    >
      <div className={cx(INSTRUMENT, "flex flex-col gap-4 p-4 sm:p-5")}>
        <ol
          aria-label="The steps"
          className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 xl:gap-0"
        >
          {STEPS.map((step, index) => {
            const leads = ROLES_IN_ORDER.filter((role) => step.who[role].part === "lead");
            const helps = ROLES_IN_ORDER.filter((role) => step.who[role].part === "help");

            return (
              <li key={step.id} className="flex flex-col gap-2 xl:pr-4">
                <div aria-hidden="true" className="flex items-center gap-2">
                  {/* A ring in the step's colour: it reads on the white panel. */}
                  <span
                    className={cx(
                      "grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] border-(--family) bg-surface text-(--family)",
                      SECTION_FAMILIES[step.family],
                    )}
                  >
                    <step.icon strokeWidth={1.75} className="size-4" />
                  </span>
                  {index < STEPS.length - 1 && (
                    <span className="hidden h-px flex-1 bg-line xl:block" />
                  )}
                </div>
                <a
                  href={`#step-${step.id}`}
                  className="w-fit rounded-sm text-sm font-semibold text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <span className="data mr-1.5 text-xs font-normal text-fg-subtle">
                    {step.number}
                  </span>
                  {step.name}
                </a>
                <p className="text-xs text-fg-muted">{step.short}</p>
                <p className="flex flex-wrap gap-1">
                  <span className="sr-only">Led by</span>
                  {leads.map((role) => (
                    <RoleChip key={role} role={role} />
                  ))}
                  {helps.length > 0 && <span className="sr-only">, helped by</span>}
                  {helps.map((role) => (
                    <RoleChip key={role} role={role} dashed />
                  ))}
                </p>
              </li>
            );
          })}
        </ol>
        {/* Where the incident stands meanwhile, under the steps it spans. */}
        <div className="grid gap-2 border-t border-line-subtle pt-4 text-xs text-fg-muted sm:grid-cols-3">
          <p className="flex flex-wrap items-center gap-2">
            <StatusMark status="DECLARED" /> Report and Decide: waiting for a decision
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <StatusMark status="INVESTIGATING" /> Respond: from the first responder’s start
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <StatusMark status="RESOLVED" /> Resolve and Learn: kept as it is
          </p>
        </div>
      </div>
    </OverviewPanel>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="numeric inline-flex items-center rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-fg-muted">
      {children}
    </span>
  );
}

/** One step: what happens, who does it, and where. */
function StepSection({ step, you }: { step: Step; you: Role }) {
  return (
    <OverviewPanel
      id={`step-${step.id}`}
      title={step.name}
      icon={step.icon}
      family={step.family}
      label={
        <span className="flex items-center gap-2">
          <Pill>
            <span className="data">Step {step.number}</span>
          </Pill>
          {step.status && <StatusMark status={step.status} />}
        </span>
      }
      description={step.summary}
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <ol
            aria-label={`What happens at ${step.name}`}
            className={cx(INSTRUMENT, "divide-y divide-line-subtle overflow-hidden")}
          >
            {step.actions.map((action, index) => (
              <li
                key={action.title}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 px-4 py-3"
              >
                <span
                  aria-hidden="true"
                  className="data grid size-6 place-items-center rounded-md border border-line-strong text-xs text-fg-subtle"
                >
                  {index + 1}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-fg">{action.title}</span>
                  <span className="text-sm text-fg-muted">{action.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className={cx(INSTRUMENT, "overflow-hidden")}>
            <p className="label-caps px-4 pt-3 pb-1.5 text-fg-subtle">Who does it</p>
            <ul aria-label={`Who does ${step.name}`} className="divide-y divide-line-subtle">
              {ROLES_IN_ORDER.map((role) => {
                const { part, text } = step.who[role];
                const mine = role === you;

                return (
                  <li
                    key={role}
                    className={cx(
                      "grid grid-cols-[8.5rem_minmax(0,1fr)] items-start gap-3 px-4 py-2.5",
                      mine && "bg-accent-subtle/60 shadow-[inset_3px_0_0_var(--color-accent-line)]",
                    )}
                  >
                    <span className="flex flex-col items-start gap-1">
                      <RoleChip role={role} />
                      <span
                        className={cx(
                          "inline-flex items-center gap-1.5 text-xs font-semibold",
                          part === "none" ? "text-fg-subtle" : roleMeta(role).tone.text,
                        )}
                      >
                        {PARTS[part].mark && (
                          <span aria-hidden="true" className={PARTS[part].mark} />
                        )}
                        {PARTS[part].label}
                        {mine && (
                          <span className="rounded-full border border-line bg-surface px-1.5 text-2xs font-medium text-fg-muted">
                            You
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="text-sm text-fg-muted">{text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <div
          className={cx(INSTRUMENT, "flex flex-wrap items-center gap-2 px-4 py-3")}
        >
          <span className="label-caps mr-1 text-fg-subtle">Where</span>
          {step.links.map((link) => (
            <PageLink key={link.label} link={link} />
          ))}
        </div>
      </div>
    </OverviewPanel>
  );
}

/** Every ability against every role; the reader's own column marked. */
function WhoCanDoWhat({ you }: { you: Role }) {
  return (
    <OverviewPanel
      id="who-can-do-what"
      title="Who can do what"
      icon={Grid3x3}
      family="setup"
      label={<Pill>4 roles</Pill>}
      description="Everything each role can do, in one place. Your own column is marked."
    >
      <div className={cx(INSTRUMENT, "overflow-x-auto")}>
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">Who can do what, by role</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold text-fg-muted">
                What
              </th>
              {ROLES_IN_ORDER.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className={cx(
                    "w-36 px-3 py-2.5 text-center",
                    role === you && "bg-accent-subtle/60",
                  )}
                >
                  <RoleChip role={role} />
                  {role === you && <span className="sr-only"> (you)</span>}
                </th>
              ))}
            </tr>
          </thead>
          {ABILITIES.map(({ group, items }) => (
            <tbody key={group}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={5}
                  className="label-caps px-4 pt-4 pb-1.5 text-left text-fg-subtle"
                >
                  {group}
                </th>
              </tr>
              {items.map(({ what, roles }) => (
                <tr key={what} className="border-t border-line-subtle">
                  <th scope="row" className="px-4 py-2 text-left font-normal text-fg">
                    {what}
                  </th>
                  {ROLES_IN_ORDER.map((role) => (
                    <td
                      key={role}
                      className={cx(
                        "px-3 py-2 text-center",
                        role === you && "bg-accent-subtle/60",
                      )}
                    >
                      {roles.includes(role) ? (
                        <span className="font-bold text-status-resolved-text">
                          <span aria-hidden="true">✓</span>
                          <span className="sr-only">Yes</span>
                        </span>
                      ) : (
                        <span className="text-fg-subtle">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">No</span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </OverviewPanel>
  );
}

const SHOWS_ICONS: LucideIcon[] = [Eye, Bell, Route, Grid3x3];

/** Where things show up, while an incident runs and after. */
function StayingOnTop() {
  return (
    <OverviewPanel
      id="staying-on-top"
      title="Staying on top of it"
      icon={Bell}
      family="setup"
      description="Where things show up while an incident runs, and afterwards."
    >
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {WHERE_IT_SHOWS.map((place, index) => {
          const Icon = SHOWS_ICONS[index];

          return (
            <li key={place.title} className={cx(INSTRUMENT, "flex flex-col gap-2 px-4 py-3.5")}>
              <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Icon aria-hidden="true" strokeWidth={1.75} className="size-4 text-fg-muted" />
                {place.title}
              </p>
              <p className="flex-1 text-sm text-fg-muted">{place.text}</p>
              {place.link && (
                <span className="pt-1">
                  <PageLink link={{ ...place.link, label: `${place.title}` }} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </OverviewPanel>
  );
}

/**
 * How SentinelOps works, for everyone in the organization: the journey of
 * an incident at a glance, each step in turn — what happens, who leads it
 * and who can help, and where it is done — then who can do what, and where
 * things show up. One page for every role, so everyone knows how an
 * incident moves, not only their own part; its links open only what the
 * reader's role can use.
 */
export function HowItWorksView() {
  const organization = useOrganization();
  const you = organization.membership.role as Role;

  return (
    <>
      <PageHeader
        title="How SentinelOps works"
        description="What happens from the moment something goes wrong to the lessons learned from it — the steps, who does each, and where in SentinelOps it is done."
        actions={
          <p className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted">
            <Eye aria-hidden="true" strokeWidth={1.75} className="size-4" />
            Reading as <RoleChip role={you} />
          </p>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          <Journey />
          <h2 className="flex items-center gap-3 text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
            Step by step
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
          </h2>
          {STEPS.map((step) => (
            <StepSection key={step.id} step={step} you={you} />
          ))}
          <WhoCanDoWhat you={you} />
          <StayingOnTop />
        </div>
      </PageBody>
    </>
  );
}
