"use client";

import {
  ChevronRight,
  IdCard,
  KeyRound,
  Lock,
  UserMinus,
  UserPlus,
  UserX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import type { ReactNode } from "react";

import { initialsOf } from "@/components/app/shell-utilities";
import { incidentAnalysisHref } from "@/components/incident-analyses/analysis-queries";
import { incidentHref } from "@/components/incidents/incident-queries";
import { RoleBadge } from "@/components/roles/role-meta";
import { useTeams } from "@/components/teams/team-scope";
import { cx } from "@/components/ui/cx";
import { FormDialog } from "@/components/ui/dialog";
import { linkClasses } from "@/components/ui/link";
import type { OrganizationMembershipResponse } from "@/lib/api/contracts";
import { useCurrentUser } from "@/lib/auth/session-provider";

import { blockerText, removalBlockers } from "./member-removal";
import { useOrganization } from "./organization-scope";

type Member = OrganizationMembershipResponse;

export type ManageAction =
  | "addToTeam"
  | "takeOffTeam"
  | "changeRole"
  | "resetPassword"
  | "remove";

/** The kind of change a section makes, and the tint it is drawn in. */
type SectionTone = "info" | "warning" | "neutral" | "danger" | "blocked";

const SECTION: Record<SectionTone, string> = {
  info: "border-info-line/70 bg-info-subtle/50",
  warning: "border-warning-line/70 bg-warning-subtle/50",
  neutral: "border-line bg-sunken",
  danger: "border-danger-line/70 bg-danger-subtle/50",
  blocked: "border-warning-line/70 bg-warning-subtle/40",
};

const TILE: Record<SectionTone, string> = {
  info: "border-info-line bg-surface text-info-text",
  warning: "border-warning-line bg-surface text-warning-text",
  neutral: "border-line-strong bg-surface text-fg-muted",
  danger: "border-danger-line bg-surface text-danger-text",
  blocked: "border-warning-line bg-surface text-warning-text",
};

const HEADING: Record<SectionTone, string> = {
  info: "text-info-text",
  warning: "text-warning-text",
  neutral: "text-fg-muted",
  danger: "text-danger-text",
  blocked: "text-warning-text",
};

/** "Payments", "Payments and Risk", "Payments, Platform and Risk". */
const listOf = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** One kind of change, in its own tint: a heading and its choices. */
function Section({
  tone,
  title,
  children,
}: {
  tone: SectionTone;
  title: string;
  children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cx("flex flex-col gap-0.5 rounded-lg border p-1.5", SECTION[tone])}
    >
      <h3
        id={headingId}
        className={cx(
          "px-2 pt-1 pb-1 text-2xs font-semibold tracking-[0.08em] uppercase",
          HEADING[tone],
        )}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * One choice: an icon in its section's tint, what it does, and — from their
 * record — what it would act on, or why it cannot be made now. Disabled, it
 * keeps its reason in view.
 */
function Choice({
  icon: Icon,
  tone,
  description,
  disabled = false,
  onSelect,
  children,
}: {
  icon: LucideIcon;
  tone: SectionTone;
  description: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
        "enabled:hover:bg-surface/70 disabled:cursor-not-allowed",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "grid size-8 shrink-0 place-items-center rounded-md border",
          disabled ? "border-line bg-sunken text-fg-disabled" : TILE[tone],
        )}
      >
        <Icon strokeWidth={2} className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span
          className={cx(
            "text-sm font-medium",
            disabled
              ? "text-fg-disabled"
              : tone === "danger"
                ? "text-danger-text"
                : "text-fg",
          )}
        >
          {children}
        </span>
        <span className={cx("text-xs", disabled ? "text-fg-disabled" : "text-fg-muted")}>
          {description}
        </span>
      </span>
      {!disabled && (
        <ChevronRight
          aria-hidden="true"
          strokeWidth={2}
          className="size-4 shrink-0 text-fg-subtle"
        />
      )}
    </button>
  );
}

/**
 * Everything that can be changed about one person, opened from their row's
 * Manage button: their teams, their role, their account, and — set apart —
 * removing them. Each section is tinted for the kind of change it makes.
 * Choosing moves on to that change's own dialog. What is offered follows
 * what the reader may do: placing people on teams, and managing members,
 * are separate rights.
 */
export function ManageMemberDialog({
  member,
  admins,
  canPlace,
  canManage,
  onAction,
  onClose,
}: {
  member: Member;
  /** The organization's Admins who still belong. */
  admins: number;
  /** May place people on teams. */
  canPlace: boolean;
  /** May manage members: role, password, removal. */
  canManage: boolean;
  onAction: (action: ManageAction) => void;
  onClose: () => void;
}) {
  const organization = useOrganization();
  const me = useCurrentUser();
  const teams = useTeams(organization.id);
  const own = member.user.id === me.data?.id;
  const first = member.user.name.split(/\s+/)[0];
  const onTeams = new Set(member.teams.map(({ id }) => id));
  const left = (teams.data ?? [])
    .filter(({ id }) => !onTeams.has(id))
    .map(({ name }) => name);
  const lastAdmin = member.role === "ADMIN" && admins <= 1;
  const blockers = removalBlockers(member, { meId: me.data?.id, admins });

  return (
    <FormDialog
      title={`Manage ${member.user.name}`}
      description={member.user.email}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        {/* Who they are now: what the choices below would change. */}
        <div className="flex items-center gap-3 rounded-lg border border-line-subtle bg-sunken px-3 py-2.5">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-accent-line bg-accent-subtle text-xs font-semibold text-accent-text"
          >
            {initialsOf(member.user.name)}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <RoleBadge role={member.role} />
            {member.teams.length === 0 ? (
              <span className="text-xs text-fg-subtle">On no team</span>
            ) : (
              member.teams.map(({ id, name }) => (
                <span
                  key={id}
                  className="rounded-full border border-line bg-hover px-2.5 py-px text-xs text-fg-muted"
                >
                  {name}
                </span>
              ))
            )}
          </div>
        </div>

        {canPlace && (
          <Section tone="info" title="Teams">
            <Choice
              icon={UserPlus}
              tone="info"
              disabled={teams.data !== undefined && left.length === 0}
              description={
                teams.data === undefined
                  ? "Which incidents they work on"
                  : left.length === 0
                    ? "Already on every team"
                    : `${left.length} ${left.length === 1 ? "team" : "teams"} left: ${listOf(left)}`
              }
              onSelect={() => onAction("addToTeam")}
            >
              Add to a team
            </Choice>
            <Choice
              icon={UserMinus}
              tone="info"
              disabled={member.teams.length === 0}
              description={
                member.teams.length === 0
                  ? "Not on any team"
                  : `On ${listOf(member.teams.map(({ name }) => name))}`
              }
              onSelect={() => onAction("takeOffTeam")}
            >
              Take off a team
            </Choice>
          </Section>
        )}

        {canManage && (
          <>
            <Section tone="warning" title="Role">
              <Choice
                icon={IdCard}
                tone="warning"
                disabled={lastAdmin}
                description={
                  lastAdmin
                    ? "The only Admin keeps their role"
                    : "What they are allowed to do"
                }
                onSelect={() => onAction("changeRole")}
              >
                Change role
              </Choice>
            </Section>

            <Section tone="neutral" title="Account">
              <Choice
                icon={KeyRound}
                tone="neutral"
                disabled={own}
                description={
                  own
                    ? "Change your own from your account"
                    : "Give them a one-time password"
                }
                onSelect={() => onAction("resetPassword")}
              >
                Reset password
              </Choice>
            </Section>

            {blockers.length === 0 ? (
              <Section tone="danger" title="Leaving">
                <Choice
                  icon={UserX}
                  tone="danger"
                  description="Ends their access. Their work stays."
                  onSelect={() => onAction("remove")}
                >
                  Remove from organization
                </Choice>
              </Section>
            ) : (
              <Section tone="blocked" title="Leaving">
                <Choice
                  icon={Lock}
                  tone="blocked"
                  disabled
                  description={
                    own
                      ? "Another Admin would do it"
                      : "Hand over their open work first"
                  }
                  onSelect={() => {}}
                >
                  {own ? "You can't remove yourself" : `Can't remove ${first} yet`}
                </Choice>
                <ul className="flex flex-col gap-1 px-2 pt-0.5 pb-1.5">
                  {blockers
                    .filter((blocker) => !(own && blocker.kind === "SELF"))
                    .map((blocker) => (
                      <li
                        key={
                          blocker.kind === "WORK"
                            ? `${blocker.work.kind}-${blocker.work.incident.number}`
                            : blocker.kind
                        }
                        className="flex items-start gap-2 text-xs text-fg-muted"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning-solid"
                        />
                        <span>
                          {blockerText(blocker)}
                          {blocker.kind === "WORK" && (
                            <>
                              {" "}
                              <Link
                                href={
                                  blocker.work.kind === "INVESTIGATING"
                                    ? incidentHref(organization.slug, blocker.work.incident.number)
                                    : incidentAnalysisHref(
                                        organization.slug,
                                        blocker.work.incident.number,
                                      )
                                }
                                className={linkClasses}
                              >
                                Open INC-{blocker.work.incident.number}
                              </Link>
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </FormDialog>
  );
}
