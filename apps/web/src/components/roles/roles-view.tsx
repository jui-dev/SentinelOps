"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Grid3x3, IdCard, Network, Split, Users } from "lucide-react";
import Link from "next/link";

import { initialsOf } from "@/components/app/shell-utilities";
import { useMemberships } from "@/components/organizations/membership-list";
import { INSTRUMENT } from "@/components/overview/analytical-view-header";
import { OverviewPanel } from "@/components/overview/overview-panel";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import type {
  OrganizationMembershipResponse,
  OrganizationRoleResponse,
  Role,
} from "@/lib/api/contracts";
import { listRoles } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

import { FLOW_ORDER, ROLE_CONTENT, STAGES, roleHref } from "./role-content";
import type { StageCell } from "./role-content";
import { ROLE_META } from "./role-meta";

export const useRoles = (organizationId: string) =>
  useQuery({
    queryKey: queryKeys.roles(organizationId),
    queryFn: () => listRoles(organizationId),
  });

/** How many hold a role, as a reader says it. */
export const peopleCount = (count: number) =>
  `${count} ${count === 1 ? "person" : "people"}`;

/** A section's label pill, as each Overview section's label is. */
export const LABEL =
  "numeric inline-flex items-center rounded-full border border-line bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted";

/** A role's icon on its own tint, in its colour. */
export function RoleIcon({
  role,
  size = "md",
}: {
  role: Role;
  size?: "sm" | "md" | "lg";
}) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;

  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid shrink-0 place-items-center border bg-sunken",
        meta.tone.line,
        meta.tone.text,
        size === "sm" && "size-8 rounded-md",
        size === "md" && "size-11 rounded-lg",
        size === "lg" && "size-15 rounded-lg",
      )}
    >
      <Icon
        strokeWidth={size === "lg" ? 1.75 : 2}
        className={size === "lg" ? "size-7" : size === "md" ? "size-5" : "size-4"}
      />
    </span>
  );
}

/** Up to four faces from the people the reader may see, then "+N". */
export function Faces({
  people,
  count,
}: {
  people: OrganizationMembershipResponse[];
  count: number;
}) {
  const shown = people.slice(0, 4);
  const more = count - shown.length;

  return (
    <span className="flex items-center gap-2">
      {shown.length > 0 && (
        <span className="flex" aria-hidden="true">
          {shown.map((person, index) => (
            <span
              key={person.id}
              title={person.user.name}
              className={cx(
                "grid size-7 place-items-center rounded-full border-2 border-surface bg-hover text-2xs font-semibold text-fg",
                index > 0 && "-ml-2",
              )}
            >
              {initialsOf(person.user.name)}
            </span>
          ))}
          {more > 0 && (
            <span className="-ml-2 grid size-7 place-items-center rounded-full border-2 border-surface bg-sunken text-2xs text-fg-subtle">
              +{more}
            </span>
          )}
        </span>
      )}
      <span className="text-xs text-fg-subtle">{peopleCount(count)}</span>
    </span>
  );
}

const YouTag = ({ role }: { role: Role }) => (
  <span
    className={cx(
      "rounded-sm border px-1.5 py-px text-2xs font-bold tracking-[0.06em] uppercase",
      ROLE_META[role].tone.text,
      ROLE_META[role].tone.line,
    )}
  >
    You
  </span>
);

// ── The steps, and a card per role under its own ───────────────────────────

function StepLine() {
  return (
    <ol
      aria-label="The steps each role leads"
      className="hidden grid-cols-4 gap-5 lg:grid"
    >
      {FLOW_ORDER.map((role, index) => {
          const { step } = ROLE_CONTENT[role];
          const last = index === 3;

          return (
            <li key={role} className="relative flex flex-col gap-1 pt-6">
              <span
                aria-hidden="true"
                className={cx(
                  "absolute top-0 left-0 size-3 rounded-full ring-4 ring-band-top",
                  ROLE_META[role].tone.subtle,
                  "border-2",
                  ROLE_META[role].tone.line,
                )}
              />
              {!last && (
                <span
                  aria-hidden="true"
                  className={cx(
                    "absolute top-[5px] right-[-1.25rem] left-4 h-0.5",
                    index === 2
                      ? "bg-[repeating-linear-gradient(90deg,var(--color-line)_0_6px,transparent_6px_12px)]"
                      : "bg-line",
                  )}
                />
              )}
              <span className="numeric text-xs text-fg-subtle">
                {step.number}
              </span>
              <span className="text-[15px] font-semibold text-fg">
                {step.name}
              </span>
            </li>
          );
        })}
    </ol>
  );
}

function RoleCard({
  role,
  count,
  people,
  you,
}: {
  role: Role;
  count: number;
  people: OrganizationMembershipResponse[];
  you: boolean;
}) {
  const organization = useOrganization();
  const meta = ROLE_META[role];

  return (
    <article
      aria-labelledby={`role-card-${role}`}
      className={cx(
        "grid grid-rows-[auto_1fr_auto] overflow-hidden rounded-lg border bg-surface",
        you ? cx("border-2", meta.tone.line) : "border-line-subtle",
      )}
    >
      <div
        className={cx(
          "flex flex-col gap-3.5 border-b bg-linear-to-br to-surface to-75% p-5",
          meta.tone.wash,
          meta.tone.line,
        )}
      >
        <div className="flex items-center justify-between">
          <RoleIcon role={role} />
          {you && <YouTag role={role} />}
        </div>
        <div className="flex flex-col gap-1">
          <h3 id={`role-card-${role}`} className="text-lg font-semibold text-fg">
            {meta.label}
          </h3>
          <span className={cx("text-sm font-semibold", meta.tone.text)}>
            {meta.tagline}
          </span>
        </div>
      </div>
      <p className="p-5 text-sm leading-relaxed text-fg-muted">{meta.purpose}</p>
      <div className="flex items-center justify-between gap-3 border-t border-line-subtle px-5 py-3.5">
        <Faces people={people} count={count} />
        <Link
          href={roleHref(organization.slug, role)}
          aria-label={`View the ${meta.label} role`}
          className="inline-flex items-center gap-0.5 rounded-sm text-sm font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          View
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}

// ── The map: who does what at each step ────────────────────────────────────

function MapCell({ cell, role }: { cell: StageCell; role: Role }) {
  const meta = ROLE_META[role];

  if (cell.kind === "none") {
    return (
      <div
        role="cell"
        className="grid min-h-24 place-items-center rounded-lg border border-dashed border-line-subtle text-fg-disabled"
      >
        <span aria-label="Not their job">—</span>
      </div>
    );
  }

  const leads = cell.kind === "lead";

  return (
    <div
      role="cell"
      className={cx(
        "flex min-h-24 flex-col gap-2.5 rounded-lg border p-3.5",
        leads
          ? cx(meta.tone.subtle, meta.tone.line)
          : "border-line-subtle bg-sunken",
      )}
    >
      <span
        className={cx(
          "flex items-center gap-1.5 text-2xs font-bold tracking-[0.08em] uppercase",
          leads ? meta.tone.text : "text-fg-subtle",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "size-2 rounded-full",
            leads ? "bg-current" : "border-2 border-fg-subtle",
          )}
        />
        {leads ? "Leads" : "Can help"}
      </span>
      <ul className="flex flex-col gap-1.5">
        {cell.jobs.map((job) => (
          <li
            key={job}
            className={cx(
              "flex items-start gap-2 text-sm leading-snug",
              leads ? "text-fg" : "text-fg-muted",
            )}
          >
            <Check
              aria-hidden="true"
              strokeWidth={2.5}
              className="mt-0.5 size-3.5 shrink-0 text-success-text"
            />
            {job}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResponsibilityMap({ yours }: { yours: Role }) {
  return (
    <div className="overflow-x-auto pb-1">
      <div
        role="table"
        aria-label="What each role does at each step"
        className="grid min-w-[64rem] grid-cols-[15rem_repeat(5,minmax(0,1fr))] gap-2.5"
      >
        <div role="row" className="contents">
          <div role="columnheader" className="flex items-end pb-3 text-xs text-fg-subtle">
            Role
          </div>
          {STAGES.map((stage) => (
            <div
              key={stage.id}
              role="columnheader"
              className="flex flex-col gap-1 pb-3"
            >
              <span
                aria-hidden="true"
                className={cx(
                  "mb-2 h-0.5 rounded-full",
                  stage.id === "setUp"
                    ? "bg-line"
                    : "bg-linear-to-r from-line-strong to-accent-mark",
                )}
              />
              <span className="numeric text-xs text-fg-subtle">
                {stage.number}
              </span>
              <span className="text-base font-semibold text-fg">
                {stage.name}
              </span>
              <span className="text-xs text-fg-subtle">{stage.description}</span>
            </div>
          ))}
        </div>
        {FLOW_ORDER.map((role) => {
          const meta = ROLE_META[role];

          return (
            <div key={role} role="row" className="contents">
              <div
                role="rowheader"
                className={cx(
                  "flex items-center gap-2.5 rounded-lg border bg-linear-to-br to-surface to-80% px-3.5 py-3",
                  meta.tone.wash,
                  meta.tone.line,
                )}
              >
                <RoleIcon role={role} size="sm" />
                <span className="text-sm font-semibold text-fg">
                  {meta.label}
                </span>
                {role === yours && (
                  <span className="ml-auto">
                    <YouTag role={role} />
                  </span>
                )}
              </div>
              {STAGES.map((stage) => (
                <MapCell
                  key={stage.id}
                  role={role}
                  cell={ROLE_CONTENT[role].map[stage.id]}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── The page ───────────────────────────────────────────────────────────────

/**
 * What each role is for, for everyone in the organization: the caller's
 * own role first, a card per role under the step it leads, and a map of
 * what each role does at each step. Read-only — a role is changed from
 * Members, by an Admin.
 */
export function RolesView() {
  const organization = useOrganization();
  const roles = useRoles(organization.id);
  const memberships = useMemberships(organization.id);
  const yours = organization.membership.role as Role;
  const yourMeta = ROLE_META[yours] ?? ROLE_META.RESPONDER;
  const you = memberships.data?.find(
    ({ id }) => id === organization.membership.id,
  );
  const teamNames = you?.teams.map(({ name }) => name) ?? [];
  const counts = new Map<string, OrganizationRoleResponse>(
    roles.data?.map((role) => [role.role, role]) ?? [],
  );
  const total = roles.data?.reduce((sum, role) => sum + role.memberCount, 0);
  const admins = memberships.data
    ?.filter(({ role }) => role === "ADMIN")
    .map(({ user }) => user.name);

  return (
    <>
      <PageHeader
        width="full"
        title="Roles"
        description={`Everyone in ${organization.name} has one role. Your role decides what you can do. Your teams decide which incidents you work on.`}
      />
      <PageBody width="full">
        <div
          className={cx(
            "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-linear-to-r to-surface to-70% px-4 py-3",
            yourMeta.tone.wash,
            yourMeta.tone.line,
          )}
        >
          <YouTag role={yours} />
          <span className={cx("text-[15px] font-semibold", yourMeta.tone.text)}>
            {yourMeta.label}
          </span>
          <span className="text-sm text-fg-muted">
            {yourMeta.tagline}
            {teamNames.length > 0 && ` · on ${teamNames.join(", ")}`}
          </span>
          <Link
            href={roleHref(organization.slug, yours)}
            className={cx(
              "ml-auto inline-flex h-9 items-center rounded-md border bg-surface px-3.5 text-sm font-semibold hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              yourMeta.tone.line,
              yourMeta.tone.text,
            )}
          >
            See your role
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </div>

        {roles.isError && <ErrorAlert error={roles.error} />}

        {/*
         * Three sections in the Overview's frame (OverviewPanel): a header
         * with its icon, label and description, the content on its own
         * panel — the darkest ground in dark, white in light (INSTRUMENT) —
         * and a note beneath, as Operational activity is.
         */}
        <OverviewPanel
          id="roles"
          title="The four roles"
          icon={Users}
          family="decision"
          label={total !== undefined && <span className={LABEL}>{peopleCount(total)}</span>}
          description="In the order an incident needs them."
        >
          <div className="flex flex-col gap-3">
            <div className={cx(INSTRUMENT, "flex flex-col gap-5 p-4 sm:p-5")}>
              <StepLine />
              {!roles.data && !roles.isError ? (
                <Spinner label="Loading roles…" />
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  {FLOW_ORDER.map((role) => (
                    <RoleCard
                      key={role}
                      role={role}
                      count={counts.get(role)?.memberCount ?? 0}
                      people={
                        memberships.data?.filter((member) => member.role === role) ?? []
                      }
                      you={role === yours}
                    />
                  ))}
                </div>
              )}
            </div>
            <p className="text-sm text-fg-muted">Each role&apos;s page lists everything it can do.</p>
          </div>
        </OverviewPanel>

        <OverviewPanel
          id="map"
          title="Who does what at each step"
          icon={Grid3x3}
          family="flow"
          label={<span className={LABEL}>5 steps</span>}
          description="Read across for a role, down for a step."
        >
          <div className="flex flex-col gap-3">
            <div className={cx(INSTRUMENT, "flex flex-col gap-4 p-4 sm:p-5")}>
              <ResponsibilityMap yours={yours} />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-fg-muted">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-accent-mark" />
                  Leads this step
                </span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="size-2.5 rounded-full border-2 border-fg-subtle" />
                  Can help
                </span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-4 rounded-sm border border-dashed border-line-strong" />
                  Not their job
                </span>
              </div>
            </div>
            <p className="text-sm text-fg-muted">Every job in detail is on each role&apos;s page.</p>
          </div>
        </OverviewPanel>

        <OverviewPanel
          id="teams"
          title="Roles and teams answer different questions"
          icon={Split}
          family="trend"
          label={<span className={LABEL}>You</span>}
          description="Your role decides what you can do; your teams decide which incidents."
        >
          <div className="flex flex-col gap-3">
            <div className={cx(INSTRUMENT, "grid gap-4 p-4 sm:p-5 md:grid-cols-2")}>
              <div className="flex flex-col gap-2.5 rounded-lg border border-line-subtle bg-surface p-6">
                <span className="flex items-center gap-2 text-2xs font-bold tracking-[0.08em] text-accent-text uppercase">
                  <IdCard aria-hidden="true" className="size-3.5" />
                  Your role
                </span>
                <span className="text-lg font-semibold text-fg">What can I do?</span>
                <p className="text-sm leading-relaxed text-fg-muted">
                  You&apos;re {/^[AEIOU]/.test(yourMeta.label) ? "an" : "a"}{" "}
                  <strong className={cx("font-semibold", yourMeta.tone.text)}>
                    {yourMeta.label}
                  </strong>
                  , so you can {ROLE_CONTENT[yours]?.youCan ?? ROLE_CONTENT.RESPONDER.youCan}.
                </p>
              </div>
              <div className="flex flex-col gap-2.5 rounded-lg border border-line-subtle bg-surface p-6">
                <span className="flex items-center gap-2 text-2xs font-bold tracking-[0.08em] text-accent-text uppercase">
                  <Network aria-hidden="true" className="size-3.5" />
                  Your teams
                </span>
                <span className="text-lg font-semibold text-fg">Which incidents?</span>
                <p className="text-sm leading-relaxed text-fg-muted">
                  {teamNames.length > 0 ? (
                    <>
                      You&apos;re on{" "}
                      <strong className="font-semibold text-fg">
                        {teamNames.join(", ")}
                      </strong>
                      , so you see the incidents on the services{" "}
                      {teamNames.length === 1 ? "it owns" : "they own"}, plus any
                      you&apos;re assigned to.
                    </>
                  ) : yours === "ADMIN" || yours === "INCIDENT_MANAGER" ? (
                    "You see every incident, whatever team it's on."
                  ) : yours === "REPORTER" ? (
                    "You see the incidents you declared, whatever team they're on."
                  ) : (
                    "You're on no team yet, so you see only the incidents you're assigned to."
                  )}
                </p>
              </div>
            </div>
            <p className="text-sm text-fg-muted">
              Everyone has exactly one role.{" "}
              {yours === "ADMIN"
                ? "Change someone's role from Members."
                : admins && admins.length > 0
                  ? `To change yours, ask ${admins.join(" or ")} (Admin).`
                  : "To change yours, ask an Admin."}
            </p>
          </div>
        </OverviewPanel>
      </PageBody>
    </>
  );
}
