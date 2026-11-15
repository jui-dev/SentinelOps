"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  IdCard,
  Info,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";

import { ROLE_META, ROLE_ORDER, roleChange } from "@/components/roles/role-meta";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { RequiredMark, RequiredNote } from "@/components/ui/required";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type {
  OrganizationMembershipResponse,
  Role,
} from "@/lib/api/contracts";
import { changeMemberRole, listMemberResponses } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { useCurrentUser } from "@/lib/auth/session-provider";

import { useCan, useOrganization } from "./organization-scope";

type Member = OrganizationMembershipResponse;

const messageFor = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.LAST_ADMIN:
      return "The only Admin keeps their role. Make someone else an Admin first.";
    case ApiErrorCode.MEMBERSHIP_NOT_FOUND:
      return "This person is no longer a member of the organization.";
    case ApiErrorCode.PERMISSION_DENIED:
      return "You do not have permission to change roles.";
    default:
      return undefined;
  }
};

/**
 * The responses this member still has under way, from the first page of
 * their history, newest first — where any under way would be. Asked only
 * when it matters: they are a Responder being given another role.
 */
const useResponsesUnderWay = (member: Member, enabled: boolean) => {
  const organization = useOrganization();
  const oversees = useCan(Permission.INCIDENTS_READ_ALL);
  const responses = useQuery({
    queryKey: [
      ...queryKeys.memberResponses(organization.id, member.id),
      "first-page",
    ],
    queryFn: () => listMemberResponses(organization.id, member.id),
    enabled: enabled && oversees,
  });

  return (
    responses.data?.items.filter(({ status }) => status === "INVESTIGATING") ??
    []
  );
};

/** One role to choose: its icon, name, and job, in its colour once chosen. */
export function RoleChoice({
  role,
  checked,
  current,
  currentLabel = "Current",
  onChange,
}: {
  role: Role;
  checked: boolean;
  current: boolean;
  /** What the marker on the role they hold says. */
  currentLabel?: string;
  onChange: () => void;
}) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;

  return (
    <label
      className={cx(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors duration-(--duration-fast)",
        checked
          ? cx(meta.tone.subtle, meta.tone.line)
          : "border-line bg-sunken hover:bg-hover",
      )}
    >
      <input
        type="radio"
        name="role"
        value={role}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-4 shrink-0 accent-accent-mark"
      />
      <span
        aria-hidden="true"
        className={cx(
          "grid size-8 shrink-0 place-items-center rounded-md border bg-surface",
          meta.tone.line,
          meta.tone.text,
        )}
      >
        <Icon strokeWidth={2} className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cx("text-sm font-semibold", meta.tone.text)}>
            {meta.label}
          </span>
          {current && (
            <span className="rounded-sm border border-line px-1.5 text-2xs font-semibold text-fg-subtle">
              {currentLabel}
            </span>
          )}
        </span>
        <span className="text-xs text-fg-muted">{meta.purpose}</span>
      </span>
    </label>
  );
}

/**
 * Gives a member another role, from the Members list's Action column — the
 * one place a role is changed. Says what the change gives and takes away
 * before it is made, and that a response already under way stays theirs to
 * complete.
 */
export function ChangeRoleDialog({
  member,
  onClose,
}: {
  member: Member;
  onClose: () => void;
}) {
  const organization = useOrganization();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const hintId = useId();
  const [chosen, setChosen] = useState<Role | null>(null);
  const first = member.user.name.split(/\s+/)[0];
  // The role they would be given: one they do not hold already.
  const target = chosen !== null && chosen !== member.role ? chosen : null;
  const changing = target !== null;
  const leavingResponse = member.role === "RESPONDER" && changing;
  const underWay = useResponsesUnderWay(member, leavingResponse);
  const change = useMutation({
    mutationFn: (role: Role) =>
      changeMemberRole(organization.id, member.id, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memberships(organization.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.roles(organization.id),
      });
      // Their own role: what this organization lets them do has changed.
      if (member.user.id === me.data?.id) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.organization(organization.id),
        });
      }
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, 404) || isApiError(error, 409)) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.memberships(organization.id),
        });
      }
    },
  });
  const { gains, loses } = target
    ? roleChange(member.role, target)
    : { gains: [], loses: [] };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (target) change.mutate(target);
  };

  return (
    <FormDialog
      title={`Change ${member.user.name}'s role`}
      description="A person has one role. Their teams stay as they are."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <RequiredNote />
        {change.isError && (
          <ErrorAlert error={change.error} message={messageFor(change.error)} />
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-sm font-medium text-fg">
            Role <RequiredMark />
          </legend>
          {ROLE_ORDER.map((role) => (
            <RoleChoice
              key={role}
              role={role}
              current={role === member.role}
              checked={role === (chosen ?? member.role)}
              onChange={() => setChosen(role)}
            />
          ))}
        </fieldset>

        {changing && (
          <section
            aria-label={`What changes for ${first}`}
            className="flex flex-col gap-2.5 rounded-lg border border-line-subtle bg-sunken px-4 py-3.5"
          >
            <h3 className="text-2xs font-semibold tracking-[0.08em] text-fg-subtle uppercase">
              What changes for {first}
            </h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {gains.map((text) => (
                <li key={`+${text}`} className="flex items-start gap-2 text-fg">
                  <Plus
                    aria-hidden="true"
                    strokeWidth={2.5}
                    className="mt-0.5 size-4 shrink-0 text-success-text"
                  />
                  <span>
                    <span className="sr-only">Can now: </span>
                    {text}
                  </span>
                </li>
              ))}
              {loses.map((text) => (
                <li
                  key={`-${text}`}
                  className="flex items-start gap-2 text-fg-muted"
                >
                  <Minus
                    aria-hidden="true"
                    strokeWidth={2.5}
                    className="mt-0.5 size-4 shrink-0 text-fg-subtle"
                  />
                  <span>
                    <span className="sr-only">No longer: </span>
                    {text}
                  </span>
                </li>
              ))}
              {underWay.length > 0 && (
                <li className="flex items-start gap-2 text-fg">
                  <CircleAlert
                    aria-hidden="true"
                    strokeWidth={2.25}
                    className="mt-0.5 size-4 shrink-0 text-warning-text"
                  />
                  <span>
                    {first} has{" "}
                    {underWay.length === 1
                      ? `a response under way on INC-${underWay[0].incident.number}`
                      : `${underWay.length} responses under way`}
                    . {underWay.length === 1 ? "It stays" : "They stay"} theirs
                    to complete.
                  </span>
                </li>
              )}
            </ul>
          </section>
        )}

        <DialogActions>
          {!changing && (
            <p
              id={hintId}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-fg-muted"
            >
              <Info aria-hidden="true" className="size-3.5 shrink-0" />
              Choose a new role to continue.
            </p>
          )}
          <Button icon={X} variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={IdCard}
            type="submit"
            disabled={!changing || change.isPending}
            aria-describedby={changing ? undefined : hintId}
          >
            {change.isPending
              ? "Changing…"
              : target
                ? `Make ${ROLE_META[target].label}`
                : "Change role"}
          </Button>
        </DialogActions>
      </form>
    </FormDialog>
  );
}
