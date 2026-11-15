"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  X,
} from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import {
  RequiredNote,
  SubmitHint,
  useRequiredFields,
} from "@/components/ui/required";
import { ApiErrorCode } from "@/lib/api/contracts";
import type { OrganizationMembershipResponse } from "@/lib/api/contracts";
import { resetMemberPassword } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { CopyButton, generateOneTimePassword } from "./add-member-form";
import { useOrganization } from "./organization-scope";

type Member = OrganizationMembershipResponse;

const messageFor = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.CANNOT_RESET_OWN_PASSWORD:
      return "Change your own password from your account, with your current one.";
    case ApiErrorCode.MEMBER_OF_OTHER_ORGANIZATIONS:
      return "This person also belongs to another organization, so their password can't be reset from here.";
    case ApiErrorCode.MEMBERSHIP_NOT_FOUND:
      return "This person is no longer a member of the organization.";
    case ApiErrorCode.PERMISSION_DENIED:
      return "You do not have permission to reset passwords.";
    default:
      return error.details.length > 0
        ? "Please correct the highlighted field."
        : undefined;
  }
};

/**
 * Gives a member who has forgotten their password a new one-time password,
 * from the Members list's Action column — the one place it is done. Says
 * what happens before it does it: their sessions end everywhere, and they
 * choose their own password at next sign-in. Once done, the new sign-in
 * details replace the form, shown this once.
 */
export function ResetPasswordDialog({
  member,
  onClose,
}: {
  member: Member;
  onClose: () => void;
}) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const { attach: requiredRef, ...required } = useRequiredFields(password);
  const first = member.user.name.split(/\s+/)[0];
  const reset = useMutation({
    mutationFn: (temporaryPassword: string) =>
      resetMemberPassword(organization.id, member.id, { temporaryPassword }),
    onSuccess: (_membership, temporaryPassword) => {
      // Their record now says they are waiting to sign in with it.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memberships(organization.id),
      });
      setDone(temporaryPassword);
    },
  });
  const fields = fieldErrorsOf(reset.error);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    reset.mutate(password);
  };

  return (
    <FormDialog
      title={`Reset ${member.user.name}'s password`}
      description="For someone who has forgotten theirs: give them a new one-time password."
      onClose={onClose}
      closeOnBackdrop={done === null}
    >
      {done !== null ? (
        <Alert
          tone="success"
          title={
            <>
              <span className="font-semibold">{member.user.name}</span>
              &apos;s password was reset.
            </>
          }
        >
          <div className="flex flex-col gap-3 pt-1">
            <p className="text-fg-muted">Give them these sign-in details.</p>
            <CopyField
              label="Sign-in email"
              value={member.user.email}
              copyLabel="Copy email"
            />
            <CopyField
              label="Sign-in password"
              value={done}
              copyLabel="Copy password"
            />
            <p className="text-fg-muted">
              They choose their own password the next time they sign in. This
              is the only time this password is shown.
            </p>
            <div>
              <Button icon={Check} size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        </Alert>
      ) : (
        <form
          ref={requiredRef}
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-4"
        >
          <RequiredNote />
          {reset.isError && (
            <ErrorAlert error={reset.error} message={messageFor(reset.error)} />
          )}
          <Alert tone="warning" title="What happens">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>
                {first} is signed out everywhere, and their old password stops
                working.
              </li>
              <li>
                They sign in with the password below, then must choose their
                own.
              </li>
            </ul>
          </Alert>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-56 flex-1">
              <Field
                label="New one-time password"
                name="temporaryPassword"
                type={shown ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                className="data"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                hint="At least 12 characters. Share it with them privately."
                required
                error={fields.temporaryPassword}
              />
            </div>
            {/* Aligned with the control, below its label. */}
            <div className="mt-6.5 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                icon={shown ? EyeOff : Eye}
                aria-pressed={!shown}
                onClick={() => setShown((value) => !value)}
              >
                {shown ? "Hide" : "Show"}
              </Button>
              <CopyButton value={password} />
              <Button
                type="button"
                variant="secondary"
                icon={KeyRound}
                onClick={() => setPassword(generateOneTimePassword())}
              >
                Generate
              </Button>
            </div>
          </div>
          <DialogActions>
            <SubmitHint id={required.hintId} missing={required.missing} />
            <Button icon={X} variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button icon={KeyRound}
              type="submit"
              disabled={reset.isPending || !required.ready}
              aria-describedby={required.ready ? undefined : required.hintId}
            >
              {reset.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogActions>
        </form>
      )}
    </FormDialog>
  );
}
