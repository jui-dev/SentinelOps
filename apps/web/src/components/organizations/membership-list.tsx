"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RotateCcw, Search, UserMinus } from "lucide-react";
import Link from "next/link";
import { Fragment, useId, useState } from "react";

import { initialsOf } from "@/components/app/shell-utilities";
import { ROLE_META, ROLE_ORDER } from "@/components/roles/role-meta";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { rowActionClasses } from "@/components/ui/row-action";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { IsoDate } from "@/components/ui/timestamp";
import { Permission } from "@/lib/api/contracts";
import type { OrganizationMembershipResponse, Role } from "@/lib/api/contracts";
import { listMemberships } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { useCurrentUser } from "@/lib/auth/session-provider";

import { ChangeRoleDialog } from "./change-role-dialog";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { ManageMemberDialog } from "./manage-member-dialog";
import type { ManageAction } from "./manage-member-dialog";
import { MemberPeek } from "./member-peek";
import {
  RemoveMemberDialog,
  RestoreMemberDialog,
  isRemoved,
} from "./member-removal";
import { AddToTeamDialog, RemoveFromTeamDialog } from "./member-placement";
import { memberHref } from "./member-paths";
import { useCan, useOrganization } from "./organization-scope";

type Member = OrganizationMembershipResponse;

/**
 * The people who belong to the organization now. Whoever manages members is
 * also sent the people removed from it, to restore them; they are left out
 * here, so no picker, count or checklist offers someone who has left.
 */
export const useMemberships = (organizationId: string) =>
  useQuery({
    queryKey: queryKeys.memberships(organizationId),
    queryFn: () => listMemberships(organizationId),
    select: (members: Member[]) => members.filter((m) => !isRemoved(m)),
  });

/**
 * Everyone the reader is sent, removed people included: for the Members
 * list's Removed filter, and for history, which still names them.
 */
export const useMembershipsWithRemoved = (organizationId: string) =>
  useQuery({
    queryKey: queryKeys.memberships(organizationId),
    queryFn: () => listMemberships(organizationId),
  });

/** How many team chips a row shows before summarising the rest. */
const SHOWN_TEAMS = 2;

/**
 * A Responder on no team responds to nothing and sees no incidents — the one
 * state on this page that wants an Admin's attention. An Admin is not
 * bound by teams, so it is no warning for them.
 */
const isUnplaced = (member: Member) =>
  member.role === "RESPONDER" && member.teams.length === 0;

// ── Filters ────────────────────────────────────────────────────────────────

type FilterId = "all" | Role | "awaiting" | "unplaced" | "removed";

const FILTERS: {
  id: FilterId;
  label: string;
  matches: (member: Member) => boolean;
  /** The role it shows, drawn as a dot of the role's colour. */
  role?: Role;
  /** A count that wants attention when above nought. */
  attention?: boolean;
  /** About account setup and placement: offered to whoever manages members. */
  setup?: boolean;
}[] = [
  // Removed people are in none of these: only under Removed, so the
  // everyday list stays the people who work here.
  { id: "all", label: "All", matches: (m) => !isRemoved(m) },
  ...ROLE_ORDER.map((role) => ({
    id: role,
    label: ROLE_META[role].plural,
    matches: (m: Member) => !isRemoved(m) && m.role === role,
    role,
  })),
  {
    id: "awaiting",
    label: "Awaiting sign-in",
    matches: (m) => !isRemoved(m) && m.user.passwordChangeRequired === true,
    attention: true,
    setup: true,
  },
  {
    id: "unplaced",
    label: "No team",
    matches: (m) => !isRemoved(m) && isUnplaced(m),
    attention: true,
    setup: true,
  },
  {
    id: "removed",
    label: "Removed",
    matches: isRemoved,
    setup: true,
  },
];

const matchesSearch = (member: Member, query: string) => {
  const q = query.trim().toLowerCase();

  return (
    q === "" ||
    member.user.name.toLowerCase().includes(q) ||
    member.user.email.toLowerCase().includes(q)
  );
};

function Toolbar({
  members,
  query,
  onQuery,
  filter,
  onFilter,
  setup,
}: {
  members: Member[];
  query: string;
  onQuery: (value: string) => void;
  filter: FilterId;
  onFilter: (value: FilterId) => void;
  /** Whether to offer the account-setup and placement filters. */
  setup: boolean;
}) {
  const searchId = useId();

  return (
    // Held in a band of the rail's own ground, as a team's glance is: the
    // ways to find people, set apart from the people found.
    <div
      role="search"
      aria-label="Find members"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-line-subtle bg-linear-to-b from-rail-top to-rail-mid p-3"
    >
      <div className="relative w-full sm:w-80">
        <label htmlFor={searchId} className="sr-only">
          Search members
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search by name or email"
          className="h-9 w-full rounded-md border border-line-control bg-field pr-3 pl-9 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        />
      </div>
      <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
        {FILTERS.filter((each) => setup || !each.setup).map((each) => {
          const count = members.filter(each.matches).length;
          const on = each.id === filter;

          return (
            <button
              key={each.id}
              type="button"
              aria-pressed={on}
              onClick={() => onFilter(each.id)}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                on
                  ? "border-accent-rim bg-accent text-on-accent"
                  : "border-line bg-surface text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              {each.role && (
                <span
                  aria-hidden="true"
                  className={cx(
                    "size-2 rounded-full border",
                    ROLE_META[each.role].tone.line,
                    on ? "bg-on-accent" : ROLE_META[each.role].tone.subtle,
                  )}
                />
              )}
              {/* The space is for the name ("All 3"); flex layout drops it. */}
              {each.label}{" "}
              <span
                className={cx(
                  "numeric text-xs",
                  on
                    ? "text-on-accent/80"
                    : each.attention && count > 0
                      ? "text-warning-text"
                      : "text-fg-subtle",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Cells ──────────────────────────────────────────────────────────────────

const BADGE =
  "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

/**
 * The heading over one role's people: the role, what it is for, and how
 * many hold it.
 */
function RoleGroupRow({
  role,
  count,
  columns,
}: {
  role: Role;
  count: number;
  columns: number;
}) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;

  return (
    <tr>
      <th
        scope="colgroup"
        colSpan={columns}
        className="border-b border-line-subtle bg-sunken px-3 pt-4 pb-2.5 text-left font-normal sm:px-4"
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
              meta.tone.text,
              meta.tone.subtle,
              meta.tone.line,
            )}
          >
            <Icon aria-hidden="true" strokeWidth={2.25} className="size-3.5" />
            {meta.plural}
          </span>
          <span className="text-xs text-fg-muted">{meta.tagline}</span>
          <span className="numeric ml-auto text-xs text-fg-subtle">
            {count} {count === 1 ? "person" : "people"}
          </span>
        </span>
      </th>
    </tr>
  );
}

/**
 * A member's teams as chips: the first two, then "+N". The whole list is in
 * the accessible name and the tooltip, so nothing is hidden from anyone —
 * the row just does not grow.
 */
function TeamChips({ teams }: { teams: Member["teams"] }) {
  if (teams.length === 0) {
    return <span className="text-fg-subtle">—</span>;
  }

  const names = teams.map(({ name }) => name);
  const more = names.length - SHOWN_TEAMS;
  const chip =
    "rounded-full border border-line bg-hover px-2.5 py-px text-xs text-fg-muted";

  return (
    <span className="flex flex-wrap gap-1.5" title={names.join(", ")}>
      <span className="sr-only">{names.join(", ")}</span>
      {names.slice(0, SHOWN_TEAMS).map((name) => (
        <span key={name} aria-hidden="true" className={chip}>
          {name}
        </span>
      ))}
      {more > 0 && (
        <span aria-hidden="true" className={cx(chip, "text-fg-subtle")}>
          +{more}
        </span>
      )}
    </span>
  );
}

function MemberStatus({ member }: { member: Member }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      {member.user.passwordChangeRequired ? (
        // Added with a one-time password they have not replaced yet.
        <span
          className={cx(
            BADGE,
            "border-warning-line bg-warning-subtle text-warning-text",
          )}
        >
          Awaiting first sign-in
        </span>
      ) : (
        <span
          className={cx(
            BADGE,
            "border-success-line bg-success-subtle text-success-text",
          )}
        >
          Active
        </span>
      )}
      {isUnplaced(member) && (
        <span className="text-xs text-warning-text">
          No team · sees no incidents
        </span>
      )}
    </span>
  );
}

/** The heading over the people removed from the organization. */
function RemovedGroupRow({ count, columns }: { count: number; columns: number }) {
  return (
    <tr>
      <th
        scope="colgroup"
        colSpan={columns}
        className="border-b border-line-subtle bg-sunken px-3 pt-4 pb-2.5 text-left font-normal sm:px-4"
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong bg-hover px-2.5 py-0.5 text-xs font-semibold text-fg-muted">
            <UserMinus aria-hidden="true" strokeWidth={2.25} className="size-3.5" />
            Removed
          </span>
          <span className="text-xs text-fg-muted">
            No access. Their history stays, marked Former member.
          </span>
          <span className="numeric ml-auto text-xs text-fg-subtle">
            {count} {count === 1 ? "person" : "people"}
          </span>
        </span>
      </th>
    </tr>
  );
}

/** Someone removed: who they were, when they left, and Restore. */
function RemovedRow({
  member,
  onRestore,
}: {
  member: Member;
  onRestore: () => void;
}) {
  const organization = useOrganization();
  const meta = ROLE_META[member.role as Role];

  return (
    <TR>
      <TD>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-xs font-semibold text-fg-subtle"
          >
            {initialsOf(member.user.name)}
          </span>
          <span className="flex min-w-0 flex-col">
            <Link
              href={memberHref(organization.slug, member.id)}
              className="truncate rounded-sm font-medium text-fg-muted hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {member.user.name}
            </Link>
            <span className="truncate text-xs text-fg-subtle">
              {member.user.email}
            </span>
          </span>
        </div>
      </TD>
      <TD className="hidden md:table-cell">
        <span
          className={cx(
            "inline-flex rounded-full border px-2.5 py-px text-xs opacity-80",
            meta.tone.text,
            meta.tone.line,
          )}
        >
          {meta.label}
        </span>
      </TD>
      <TD className="hidden sm:table-cell">
        <span className={cx(BADGE, "border-line-strong bg-hover text-fg-muted")}>
          Former member
        </span>
      </TD>
      <TD kind="data" className="hidden lg:table-cell">
        {member.removal && (
          <span className="flex flex-col gap-0.5">
            <IsoDate value={member.removal.removedAt} />
            {member.removal.removedBy && (
              <span className="text-xs text-fg-subtle">
                by {member.removal.removedBy.name}
              </span>
            )}
          </span>
        )}
      </TD>
      <TD kind="actions">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            aria-label={`Restore ${member.user.name}`}
            onClick={onRestore}
            className={rowActionClasses("info")}
          >
            <RotateCcw aria-hidden="true" strokeWidth={2.25} className="size-3.5" />
            Restore
          </button>
        </div>
      </TD>
    </TR>
  );
}

// ── The list ───────────────────────────────────────────────────────────────

const DIALOG_FOR = {
  addToTeam: "add",
  takeOffTeam: "remove",
  changeRole: "role",
  resetPassword: "password",
  remove: "removeOrg",
} as const satisfies Record<ManageAction, string>;

type Dialog = {
  kind:
    | "manage"
    | "add"
    | "remove"
    | "role"
    | "password"
    | "removeOrg"
    | "restore";
  memberId: string;
} | null;

/**
 * Everyone in the organization, grouped by role, found by name or email and
 * narrowed by role or by what wants attention. Placing someone on a team,
 * taking them off one, changing their role and resetting their password
 * happen here — each row's Add to team, Remove, Change role and Reset
 * password — and nowhere else; a member's own page reads.
 */
export function MembershipList() {
  const organization = useOrganization();
  const memberships = useMembershipsWithRemoved(organization.id);
  const me = useCurrentUser();
  // Placing people on teams is team configuration: whoever manages teams.
  const canPlace = useCan(Permission.TEAMS_MANAGE);
  // Account setup — who has signed in, who is on no team — is for whoever
  // sets accounts up. A member reading the directory sees their colleagues,
  // and the API sends them no setup to show.
  const canManage = useCan(Permission.MEMBERS_MANAGE);
  // Nothing to change about anyone: no Action column at all.
  const hasActions = canPlace || canManage;
  const columns = 3 + (canManage ? 1 : 0) + (hasActions ? 1 : 0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [dialog, setDialog] = useState<Dialog>(null);
  // Any number open at once, so people can be compared side by side.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (memberId: string) =>
    setExpanded((current) => {
      const next = new Set(current);

      if (!next.delete(memberId)) next.add(memberId);

      return next;
    });

  if (memberships.isError) return <ErrorAlert error={memberships.error} />;
  if (!memberships.data) return <Spinner label="Loading members…" />;

  const all = memberships.data;
  const matches = FILTERS.find(({ id }) => id === filter)!.matches;
  const shown = all.filter(
    (member) => matches(member) && matchesSearch(member, query),
  );
  const admins = all.filter(
    (member) => member.role === "ADMIN" && !isRemoved(member),
  ).length;
  const showingRemoved = filter === "removed";
  // Read from the list as it stands, so a dialog shows the latest teams.
  const target = dialog && all.find(({ id }) => id === dialog.memberId);
  const close = () => setDialog(null);

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        members={all}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        setup={canManage}
      />
      <Table label="Members">
        <THead>
          <TR>
            <TH>Person</TH>
            <TH className="hidden md:table-cell">
              {showingRemoved ? "Role before" : "Teams"}
            </TH>
            {canManage && <TH className="hidden sm:table-cell">Status</TH>}
            <TH className="hidden lg:table-cell">
              {showingRemoved ? "Removed" : "Joined"}
            </TH>
            {hasActions && <TH align="end">Action</TH>}
          </TR>
        </THead>
        <TBody>
          {shown.length === 0 ? (
            <TR>
              <TD colSpan={columns} className="py-6 text-center text-sm text-fg-muted">
                No members match.{" "}
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Show everyone
                </Button>
              </TD>
            </TR>
          ) : showingRemoved ? (
            <>
              <RemovedGroupRow count={shown.length} columns={columns} />
              {shown.map((member) => (
                <RemovedRow
                  key={member.id}
                  member={member}
                  onRestore={() =>
                    setDialog({ kind: "restore", memberId: member.id })
                  }
                />
              ))}
            </>
          ) : (
            ROLE_ORDER.map((role) => {
              const group = shown.filter((member) => member.role === role);

              if (group.length === 0) return null;

              return (
                <Fragment key={role}>
                  <RoleGroupRow
                    role={role}
                    count={group.length}
                    columns={columns}
                  />
                  {group.map((member) => {
              const open = expanded.has(member.id);
              const peekId = `member-peek-${member.id}`;

              return (
              <Fragment key={member.id}>
              <TR
                // A click anywhere on the row opens it, as the chevron does —
                // but not one meant for an action, or the chevron itself.
                onClick={(event) => {
                  if ((event.target as Element).closest("a, button")) return;
                  toggle(member.id);
                }}
                className="cursor-pointer"
              >
                <TD>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={open ? peekId : undefined}
                      aria-label={`${open ? "Hide" : "Show"} teams of ${member.user.name}`}
                      onClick={() => toggle(member.id)}
                      className="-ml-1 grid size-6 shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        strokeWidth={2}
                        className={cx(
                          "size-4 transition-transform duration-(--duration-fast)",
                          open && "rotate-90",
                        )}
                      />
                    </button>
                    <span
                      aria-hidden="true"
                      className="grid size-8 shrink-0 place-items-center rounded-full border border-accent-line bg-accent-subtle text-xs font-semibold text-accent-text"
                    >
                      {initialsOf(member.user.name)}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5">
                        {/* Their page: the name is the way there. */}
                        <Link
                          href={memberHref(organization.slug, member.id)}
                          className="truncate rounded-sm font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          {member.user.name}
                        </Link>
                        {member.user.id === me.data?.id && (
                          <span className="rounded-sm border border-accent-line px-1 text-2xs text-accent-text">
                            You
                          </span>
                        )}
                      </span>
                      <span className="truncate text-xs text-fg-subtle">
                        {member.user.email}
                      </span>
                      {/* On a phone the status folds under the person. */}
                      {canManage && (
                        <span className="pt-1 sm:hidden">
                          <MemberStatus member={member} />
                        </span>
                      )}
                    </span>
                  </div>
                </TD>
                <TD className="hidden md:table-cell">
                  <TeamChips teams={member.teams} />
                </TD>
                {canManage && (
                  <TD className="hidden sm:table-cell">
                    <MemberStatus member={member} />
                  </TD>
                )}
                <TD kind="data" className="hidden lg:table-cell">
                  <IsoDate value={member.createdAt} />
                </TD>
                {hasActions && (
                  <TD kind="actions">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        aria-label={`Manage ${member.user.name}`}
                        aria-haspopup="dialog"
                        onClick={() =>
                          setDialog({ kind: "manage", memberId: member.id })
                        }
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface pr-2 pl-3 text-sm font-medium text-fg shadow-control transition-colors duration-(--duration-fast) hover:border-line-control hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        Manage
                        <ChevronRight
                          aria-hidden="true"
                          strokeWidth={2}
                          className="size-4 text-fg-subtle"
                        />
                      </button>
                    </div>
                  </TD>
                )}
              </TR>
              {open && (
                // A plain row, outside the table's hover: the row above, opened.
                <tr id={peekId}>
                  <td
                    colSpan={columns}
                    className="border-b border-line-subtle bg-sunken px-3 py-3 sm:px-4"
                  >
                    <MemberPeek member={member} />
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
                </Fragment>
              );
            })
          )}
        </TBody>
      </Table>
      {hasActions && target && dialog.kind === "manage" && (
        <ManageMemberDialog
          key={target.id}
          member={target}
          admins={admins}
          canPlace={canPlace}
          canManage={canManage}
          onClose={close}
          // One dialog at a time: the choice replaces this one.
          onAction={(action) =>
            setDialog({ kind: DIALOG_FOR[action], memberId: target.id })
          }
        />
      )}
      {canPlace && target && dialog.kind === "add" && (
        <AddToTeamDialog key={target.id} member={target} onClose={close} />
      )}
      {canPlace && target && dialog.kind === "remove" && (
        <RemoveFromTeamDialog key={target.id} member={target} onClose={close} />
      )}
      {canManage && target && dialog.kind === "role" && (
        <ChangeRoleDialog key={target.id} member={target} onClose={close} />
      )}
      {canManage && target && dialog.kind === "password" && (
        <ResetPasswordDialog key={target.id} member={target} onClose={close} />
      )}
      {canManage && target && dialog.kind === "removeOrg" && (
        <RemoveMemberDialog key={target.id} member={target} onClose={close} />
      )}
      {canManage && target && dialog.kind === "restore" && (
        <RestoreMemberDialog key={target.id} member={target} onClose={close} />
      )}
    </div>
  );
}
