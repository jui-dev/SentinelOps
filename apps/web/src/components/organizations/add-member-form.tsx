"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { Field } from "@/components/ui/field";
import { Section } from "@/components/ui/page";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type { CreateMemberRequest } from "@/lib/api/contracts";
import { createMember } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { formatRole } from "./format";
import { useCan, useOrganizationId } from "./organization-scope";

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
 * Adds a member. What goes stale is the membership list: the new person is in
 * it, marked as awaiting their first sign-in.
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
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.memberships(organizationId),
        exact: true,
      });
    },
  });
};

const messageFor = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;

  switch (error.code) {
    case ApiErrorCode.EMAIL_ALREADY_REGISTERED:
      return "An account with this email already exists.";
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
}

/**
 * The sign-in details to hand over, shown once. The password lives in this
 * component's state and nowhere else, and is gone on Done.
 */
function AddedMember({ added, onDone }: { added: Added; onDone: () => void }) {
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
        <p className="text-fg-muted">Give them these sign-in details.</p>
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
        <div>
          <Button variant="secondary" size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </Alert>
  );
}

export function AddMemberForm() {
  const organizationId = useOrganizationId();
  const canManage = useCan(Permission.MEMBERS_MANAGE);
  const create = useCreateMember(organizationId);
  const [password, setPassword] = useState("");
  const [added, setAdded] = useState<Added | null>(null);

  if (!canManage) return null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body: CreateMemberRequest = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      temporaryPassword: password,
    };

    setAdded(null);
    create.mutate(body, {
      onSuccess: (membership) => {
        setAdded({
          name: membership.user.name,
          email: membership.user.email,
          role: membership.role,
          password: body.temporaryPassword,
        });
        create.reset();
        form.reset();
        setPassword("");
      },
    });
  };

  const fields = fieldErrorsOf(create.error);

  return (
    <Section
      title="Add a member"
      description="Create their account as a Member, with a one-time password to hand them. They choose their own when they first sign in."
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex max-w-2xl flex-col gap-4"
      >
        {create.isError && (
          <ErrorAlert error={create.error} message={messageFor(create.error)} />
        )}
        {added && <AddedMember added={added} onDone={() => setAdded(null)} />}
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
        <div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Adding…" : "Add member"}
          </Button>
        </div>
      </form>
    </Section>
  );
}
