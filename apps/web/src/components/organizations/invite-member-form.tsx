"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { Field } from "@/components/ui/field";
import { Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import {
  RequiredNote,
  SubmitHint,
  useRequiredFields,
} from "@/components/ui/required";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type {
  CreateInvitationRequest,
  InvitableRole,
} from "@/lib/api/contracts";
import { createInvitation } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { useCan, useOrganizationId } from "./organization-scope";

const ROLES: { value: InvitableRole; label: string }[] = [
  { value: "MEMBER", label: "Member" },
  { value: "ADMIN", label: "Admin" },
];

/**
 * Creates an invitation. What goes stale is the open-invitation list only:
 * nobody has joined yet, so memberships and `me` are unchanged.
 *
 * The response carries the invitation token. The mutation is dropped from
 * the cache as soon as nothing observes it, and the form moves the token into
 * its own state and resets the mutation, so the token lives in exactly one
 * place, for as long as the link is on screen.
 */
export const useCreateInvitation = (organizationId: string) => {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.invitations(organizationId),
      exact: true,
    });

  return useMutation({
    mutationFn: (body: CreateInvitationRequest) =>
      createInvitation(organizationId, body),
    gcTime: 0,
    onSuccess: () => {
      void invalidate();
    },
    onError: (error) => {
      // Someone else's invitation for this address now exists: show it.
      if (
        isApiError(error, 409) &&
        error.code === ApiErrorCode.INVITATION_ALREADY_PENDING
      ) {
        void invalidate();
      }
    },
  });
};

/** The link an invitee opens. The token rides in the fragment, which is never sent to a server. */
export const invitationLink = (token: string): string =>
  `${window.location.origin}/invite#${token}`;

interface IssuedLink {
  link: string;
  email: string;
  replacedExisting: boolean;
}

const messageFor = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.INVITATION_ALREADY_PENDING:
      return "An invitation for this email was just created by someone else. It's now in the list below. To issue a new link yourself, invite again — that replaces the existing one.";
    case ApiErrorCode.ALREADY_A_MEMBER:
      return "That person is already a member of this organization.";
    case ApiErrorCode.PERMISSION_DENIED:
      return "You do not have permission to invite members.";
    default:
      return error.details.length > 0
        ? "Please correct the highlighted fields."
        : undefined;
  }
};

function IssuedInvitation({
  issued,
  onDone,
}: {
  issued: IssuedLink;
  onDone: () => void;
}) {
  return (
    <Alert
      tone="success"
      title={
        <>
          Invitation created for{" "}
          <span className="font-semibold">{issued.email}</span>.
        </>
      }
    >
      <div className="flex flex-col gap-3 pt-1">
        <CopyField
          label="Invitation link"
          value={issued.link}
          copyLabel="Copy link"
        />
        <p className="text-fg-muted">
          Anyone with this link may be able to accept this invitation. Share it
          only with the intended recipient. It expires in 7 days, and this is
          the only time it is shown.
        </p>
        {issued.replacedExisting && (
          <p className="text-fg-muted">
            The previous link for this email no longer works.
          </p>
        )}
        <div>
          <Button variant="secondary" size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </Alert>
  );
}

export function InviteMemberForm() {
  const organizationId = useOrganizationId();
  const canManage = useCan(Permission.INVITATIONS_MANAGE);
  const create = useCreateInvitation(organizationId);
  const [issued, setIssued] = useState<IssuedLink | null>(null);

  const { attach: requiredRef, ...required } = useRequiredFields();

  if (!canManage) return null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "");
    const role = String(data.get("role") ?? "MEMBER") as InvitableRole;

    setIssued(null);
    create.mutate(
      { email, role },
      {
        onSuccess: (response) => {
          setIssued({
            link: invitationLink(response.token),
            email: response.invitation.email,
            replacedExisting: response.replacedExisting,
          });
          create.reset();
          form.reset();
        },
      },
    );
  };

  const fields = fieldErrorsOf(create.error);

  return (
    <Section
      title="Invite a member"
      level={3}
      description="You'll get a link to share with them. Inviting an email that already has an open invitation replaces it."
    >
      <form
        ref={requiredRef}
        onSubmit={onSubmit}
        noValidate
        className="flex max-w-2xl flex-col gap-4"
      >
        <RequiredNote />
        {create.isError && (
          <ErrorAlert error={create.error} message={messageFor(create.error)} />
        )}
        {issued && (
          <IssuedInvitation issued={issued} onDone={() => setIssued(null)} />
        )}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-56 flex-1">
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="off"
              placeholder="name@company.com"
              required
              error={fields.email}
            />
          </div>
          <div className="w-36">
            <Select label="Role" name="role" defaultValue="MEMBER">
              {ROLES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          {/* Aligned with the controls, below their labels. */}
          <Button
            type="submit"
            disabled={create.isPending || !required.ready}
            aria-describedby={required.ready ? undefined : required.hintId}
            className="mt-6.5"
          >
            {create.isPending ? "Creating…" : "Create invitation"}
          </Button>
        </div>
        <SubmitHint id={required.hintId} missing={required.missing} />
      </form>
    </Section>
  );
}
