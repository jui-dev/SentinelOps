"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Info,
  RotateCcw,
  UserX,
  X,
} from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { ROLE_ORDER } from "@/components/roles/role-meta";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { RequiredMark, RequiredNote } from "@/components/ui/required";
import { IsoDate } from "@/components/ui/timestamp";
import { ApiErrorCode } from "@/lib/api/contracts";
import type {
  MemberOpenWork,
  OrganizationMembershipResponse,
  Role,
} from "@/lib/api/contracts";
import { removeMember, restoreMember } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { RoleChoice } from "./change-role-dialog";
import { useOrganization } from "./organization-scope";

type Member = OrganizationMembershipResponse;

export const isRemoved = (member: Member): boolean => Boolean(member.removal);

/**
 * Why someone cannot be removed now, in the order to read them: what can
 * never be done, then each piece of open work, which is fixed where it is.
 * Empty when nothing stops it.
 */
export type RemovalBlocker =
  | { kind: "SELF" }
  | { kind: "LAST_ADMIN" }
  | { kind: "WORK"; work: MemberOpenWork };

export const removalBlockers = (
  member: Member,
  { meId, admins }: { meId: string | undefined; admins: number },
): RemovalBlocker[] => [
  ...(member.user.id === meId ? [{ kind: "SELF" as const }] : []),
  ...(member.role === "ADMIN" && admins <= 1
    ? [{ kind: "LAST_ADMIN" as const }]
    : []),
  ...(member.openWork ?? []).map((work) => ({ kind: "WORK" as const, work })),
];

export const blockerText = (blocker: RemovalBlocker): string => {
  switch (blocker.kind) {
    case "SELF":
      return "You can't remove yourself.";
    case "LAST_ADMIN":
      return "The organization's only Admin can't be removed. Make someone else Admin first.";
    case "WORK":
      return blocker.work.kind === "INVESTIGATING"
        ? `Still investigating INC-${blocker.work.incident.number}. They complete their response, or the incident is resolved.`
        : `Owns the unpublished analysis of INC-${blocker.work.incident.number}. Change its owner first.`;
  }
};

/** Everything that shows who belongs: the list, the role counts, the teams. */
const useRefreshPeople = () => {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return () => {
    for (const queryKey of [
      queryKeys.memberships(organization.id),
      queryKeys.roles(organization.id),
      queryKeys.teams(organization.id),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
};

const removeMessageFor = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.MEMBER_HAS_OPEN_WORK:
      return "They have open work to hand over first: a response under way, or an analysis they own. The list has been refreshed.";
    case ApiErrorCode.CANNOT_REMOVE_SELF:
      return "You can't remove yourself from the organization.";
    case ApiErrorCode.LAST_ADMIN:
      return "The organization's only Admin can't be removed. Make someone else Admin first.";
    case ApiErrorCode.MEMBER_REMOVED:
      return "They were removed already.";
    case ApiErrorCode.MEMBERSHIP_NOT_FOUND:
      return "This person is no longer a member of the organization.";
    case ApiErrorCode.PERMISSION_DENIED:
      return "You do not have permission to remove members.";
    default:
      return undefined;
  }
};

function Consequence({
  kept,
  children,
}: {
  kept: boolean;
  children: ReactNode;
}) {
  const Icon = kept ? Check : X;

  return (
    <li className="flex items-start gap-2">
      <Icon
        aria-hidden="true"
        strokeWidth={2.5}
        className={
          kept
            ? "mt-0.5 size-4 shrink-0 text-success-text"
            : "mt-0.5 size-4 shrink-0 text-danger-text"
        }
      />
      <span>{children}</span>
    </li>
  );
}

const sectionHeading =
  "text-2xs font-semibold tracking-[0.08em] text-fg-subtle uppercase";

/**
 * Removes someone from the organization, from the Members list's More menu —
 * the one place it is done. Says what ends and what stays before it does it.
 * They are not notified.
 */
export function RemoveMemberDialog({
  member,
  onClose,
}: {
  member: Member;
  onClose: () => void;
}) {
  const organization = useOrganization();
  const refresh = useRefreshPeople();
  const remove = useMutation({
    mutationFn: () => removeMember(organization.id, member.id),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (error) => {
      // What stopped it is shown on the list once it is read again.
      if (isApiError(error, 404) || isApiError(error, 409)) refresh();
    },
  });
  const teams = member.teams.map(({ name }) => name);

  return (
    <FormDialog
      title={`Remove ${member.user.name} from ${organization.name}?`}
      description="Use this when someone leaves. You can restore them later."
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {remove.isError && (
          <ErrorAlert
            error={remove.error}
            message={removeMessageFor(remove.error)}
          />
        )}
        <section aria-labelledby="removal-now" className="flex flex-col gap-2">
          <h3 id="removal-now" className={sectionHeading}>
            What happens now
          </h3>
          <ul className="flex flex-col gap-2 text-sm text-fg">
            <Consequence kept={false}>
              They lose access to this organization at once, on their next
              click.
            </Consequence>
            <Consequence kept={false}>
              {teams.length > 0 ? (
                <>
                  They come off their{" "}
                  {teams.length === 1 ? "team" : "teams"}:{" "}
                  <span className="font-medium">{teams.join(", ")}</span>.
                </>
              ) : (
                "They are on no team, so no team changes."
              )}
            </Consequence>
            <Consequence kept={false}>
              They are taken off any incident they were assigned to and had not
              started.
            </Consequence>
          </ul>
        </section>
        <section aria-labelledby="removal-stays" className="flex flex-col gap-2">
          <h3 id="removal-stays" className={sectionHeading}>
            What stays
          </h3>
          <ul className="flex flex-col gap-2 text-sm text-fg">
            <Consequence kept>
              Their past responses, updates and analyses, under their name,
              marked Former member.
            </Consequence>
            <Consequence kept>
              Their account. If they belong to other organizations, nothing
              changes there.
            </Consequence>
          </ul>
        </section>
        <p className="flex items-start gap-2 rounded-md border border-line-subtle bg-sunken px-3 py-2.5 text-xs text-fg-muted">
          <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          They are not notified. The removal is written to the Activity log.
        </p>
        <DialogActions>
          <Button icon={X} variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={UserX}
            variant="danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Removing…" : "Remove from organization"}
          </Button>
        </DialogActions>
      </div>
    </FormDialog>
  );
}

const restoreMessageFor = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.MEMBER_NOT_REMOVED:
      return "They belong to the organization already. The list has been refreshed.";
    case ApiErrorCode.MEMBERSHIP_NOT_FOUND:
      return "This person can no longer be found.";
    case ApiErrorCode.PERMISSION_DENIED:
      return "You do not have permission to restore members.";
    default:
      return undefined;
  }
};

/**
 * Brings a removed person back, from the Removed list's Restore — or from
 * Add member, when their email is given again. Their previous role is
 * chosen to start with; they come back on no team.
 */
export function RestoreMemberDialog({
  member,
  onClose,
}: {
  member: Member;
  onClose: () => void;
}) {
  const organization = useOrganization();
  const refresh = useRefreshPeople();
  const before = member.role as Role;
  const [role, setRole] = useState<Role>(before);
  const restore = useMutation({
    mutationFn: (chosen: Role) =>
      restoreMember(organization.id, member.id, { role: chosen }),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, 404) || isApiError(error, 409)) refresh();
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    restore.mutate(role);
  };

  return (
    <FormDialog
      title={`Restore ${member.user.name}?`}
      description={
        member.removal ? (
          <>
            Removed <IsoDate value={member.removal.removedAt} />
            {member.removal.removedBy && ` by ${member.removal.removedBy.name}`}
            . They sign in with the password they already have.
          </>
        ) : (
          "They sign in with the password they already have."
        )
      }
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <RequiredNote />
        {restore.isError && (
          <ErrorAlert
            error={restore.error}
            message={restoreMessageFor(restore.error)}
          />
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-sm font-medium text-fg">
            Role <RequiredMark />
          </legend>
          {ROLE_ORDER.map((each) => (
            <RoleChoice
              key={each}
              role={each}
              current={each === before}
              currentLabel="Their role before"
              checked={each === role}
              onChange={() => setRole(each)}
            />
          ))}
        </fieldset>
        <p className="flex items-start gap-2 rounded-md border border-line-subtle bg-sunken px-3 py-2.5 text-xs text-fg-muted">
          <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          They come back on no team, so they see no incidents yet. Place them
          with Add to team. Their history loses the Former member label.
        </p>
        <DialogActions>
          <Button icon={X} variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={RotateCcw} type="submit" disabled={restore.isPending}>
            {restore.isPending ? "Restoring…" : "Restore"}
          </Button>
        </DialogActions>
      </form>
    </FormDialog>
  );
}
