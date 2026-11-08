"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { linkClasses } from "@/components/ui/link";
import { Spinner } from "@/components/ui/spinner";
import {
  RequiredNote,
  SubmitHint,
  useRequiredFields,
} from "@/components/ui/required";
import { teamsHref, useTeams } from "@/components/teams/team-scope";
import { ApiErrorCode } from "@/lib/api/contracts";
import type { CreateMemberRequest } from "@/lib/api/contracts";
import { createMember } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { formatRole } from "./format";
import { useOrganization } from "./organization-scope";

/**
 * 32 characters, so a random byte masked to five bits picks one without bias.
 * No `l`, `o`, `0`, or `1`: the password is read aloud or retyped by a person.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * A one-time password: 16 random characters from the browser's CSPRNG, in
 * groups of four so it can be read out — 80 bits, and 19 characters with the
 * hyphens, comfortably past the API's 12-character minimum.
 */
export const generateOneTimePassword = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const characters = Array.from(bytes, (byte) => ALPHABET[byte & 31]);

  return [0, 4, 8, 12]
    .map((start) => characters.slice(start, start + 4).join(""))
    .join("-");
};

/**
 * Adds a member. What goes stale is the membership list — the new person is
 * in it, marked as awaiting their first sign-in — and, when they were placed
 * on teams, the teams: their member counts and member lists.
 *
 * The one-time password is in the request only. It is never in the response,
 * and the mutation is dropped from the cache as soon as nothing observes it.
 */
const useCreateMember = (organizationId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateMemberRequest) =>
      createMember(organizationId, body),
    gcTime: 0,
    onSuccess: (membership) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memberships(organizationId),
        exact: true,
      });

      if (membership.teams.length > 0) {
        // A prefix: the team list and every team's member list beneath it.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.teams(organizationId),
        });
      }
    },
    onError: (error) => {
      // A chosen team was deleted meanwhile: show the teams as they are now.
      if (isApiError(error, 404) && error.code === ApiErrorCode.TEAM_NOT_FOUND) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.teams(organizationId),
          exact: true,
        });
      }
    },
  });
};

const messageFor = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.EMAIL_ALREADY_REGISTERED:
      return "An account with this email already exists.";
    case ApiErrorCode.TEAM_NOT_FOUND:
      return "One of the chosen teams no longer exists. The list has been refreshed; choose again. No one was added.";
    case ApiErrorCode.PERMISSION_DENIED:
      return "You do not have permission to add members.";
    default:
      return error.details.length > 0
        ? "Please correct the highlighted fields."
        : undefined;
  }
};

interface Added {
  name: string;
  email: string;
  role: string;
  password: string;
  teams: string[];
}

/**
 * The organization's teams as checkboxes, all optional. Native inputs in the
 * design system's colours rather than a new control: a fieldset and a legend
 * are exactly the semantics a set of choices needs.
 */
function TeamChoices({ disabled }: { disabled: boolean }) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 flex items-baseline gap-2 text-sm font-medium text-fg">
        Teams
        <span className="text-xs font-normal text-fg-subtle">Optional</span>
      </legend>
      {teams.isError ? (
        <ErrorAlert error={teams.error} />
      ) : !teams.data ? (
        <Spinner label="Loading teams…" />
      ) : teams.data.length === 0 ? (
        <p className="text-sm text-fg-muted">
          There are no teams yet.{" "}
          <Link href={teamsHref(organization.slug)} className={linkClasses}>
            Create one
          </Link>{" "}
          to give people operational responsibility.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {teams.data.map((team) => (
              <li key={team.id}>
                <label className="inline-flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    name="teamIds"
                    value={team.id}
                    className="size-4 accent-accent"
                  />
                  {team.name}
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-subtle">
            The teams whose incidents they will respond to. You can change this
            later.
          </p>
        </>
      )}
    </fieldset>
  );
}

/**
 * The sign-in details to hand over, shown once, in place of the form. The
 * password lives in the dialog's state and nowhere else, and is gone on "Add
 * another" or on closing the dialog.
 */
function AddedMember({
  added,
  onAnother,
  onDone,
}: {
  added: Added;
  onAnother: () => void;
  onDone: () => void;
}) {
  return (
    <Alert
      tone="success"
      title={
        <>
          <span className="font-semibold">{added.name}</span> was added as a{" "}
          {formatRole(added.role)}.
        </>
      }
    >
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-fg-muted">
          {added.teams.length > 0
            ? `On ${added.teams.join(", ")}. `
            : "Not on any team yet. "}
          Give them these sign-in details.
        </p>
        <CopyField
          label="Sign-in email"
          value={added.email}
          copyLabel="Copy email"
        />
        <CopyField
          label="Sign-in password"
          value={added.password}
          copyLabel="Copy password"
        />
        <p className="text-fg-muted">
          They choose their own password the first time they sign in, and
          can&apos;t do anything else until they have. This is the only time
          this password is shown.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
          <Button variant="secondary" size="sm" onClick={onAnother}>
            Add another
          </Button>
        </div>
      </div>
    </Alert>
  );
}

function AddMemberForm({
  onAdded,
  onCancel,
}: {
  onAdded: (added: Added) => void;
  onCancel: () => void;
}) {
  const organization = useOrganization();
  const create = useCreateMember(organization.id);
  const [password, setPassword] = useState("");
  const { attach: requiredRef, ...required } = useRequiredFields(password);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body: CreateMemberRequest = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      temporaryPassword: password,
      teamIds: data.getAll("teamIds").map(String),
    };

    create.mutate(body, {
      onSuccess: (membership) =>
        onAdded({
          name: membership.user.name,
          email: membership.user.email,
          role: membership.role,
          password: body.temporaryPassword,
          teams: membership.teams.map(({ name }) => name),
        }),
    });
  };

  const fields = fieldErrorsOf(create.error);

  return (
    <form
      ref={requiredRef}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
      <RequiredNote />
      {create.isError && (
        <ErrorAlert error={create.error} message={messageFor(create.error)} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Name"
          name="name"
          autoComplete="off"
          required
          error={fields.name}
        />
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
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-56 flex-1">
          <Field
            label="One-time password"
            name="temporaryPassword"
            autoComplete="off"
            spellCheck={false}
            className="data"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint="At least 12 characters."
            required
            error={fields.temporaryPassword}
          />
        </div>
        {/* Aligned with the controls, below their labels. */}
        <Button
          type="button"
          variant="secondary"
          icon={KeyRound}
          className="mt-6.5"
          onClick={() => setPassword(generateOneTimePassword())}
        >
          Generate
        </Button>
      </div>
      <TeamChoices disabled={create.isPending} />
      <DialogActions>
        <SubmitHint id={required.hintId} missing={required.missing} />
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={create.isPending || !required.ready}
          aria-describedby={required.ready ? undefined : required.hintId}
        >
          {create.isPending ? "Adding…" : "Add member"}
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * Adding a member, in a dialog over Members: identity, a one-time password,
 * and optionally their teams. Once added, their sign-in details replace the
 * form; a stray click on the backdrop then does not close it, since the
 * password is shown only this once.
 */
export function AddMemberDialog({ onClose }: { onClose: () => void }) {
  const [added, setAdded] = useState<Added | null>(null);
  // Remounted on "Add another", so the form starts empty.
  const [round, setRound] = useState(0);

  return (
    <FormDialog
      title="Add member"
      description="Create their account as a Member, with a one-time password to hand them. They choose their own when they first sign in."
      onClose={onClose}
      closeOnBackdrop={!added}
    >
      {added ? (
        <AddedMember
          added={added}
          onDone={onClose}
          onAnother={() => {
            setAdded(null);
            setRound((current) => current + 1);
          }}
        />
      ) : (
        <AddMemberForm key={round} onAdded={setAdded} onCancel={onClose} />
      )}
    </FormDialog>
  );
}
