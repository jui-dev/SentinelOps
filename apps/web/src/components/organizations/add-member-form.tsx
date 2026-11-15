"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  RotateCcw,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { cx } from "@/components/ui/cx";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { linkClasses } from "@/components/ui/link";
import {
  RequiredNote,
  SubmitHint,
  useRequiredFields,
} from "@/components/ui/required";
import { Spinner } from "@/components/ui/spinner";
import { ROLE_META, ROLE_ORDER } from "@/components/roles/role-meta";
import { teamsHref, useTeams } from "@/components/teams/team-scope";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type {
  CreateMemberRequest,
  OrganizationMembershipResponse,
  Role,
} from "@/lib/api/contracts";
import { createMember, listMemberships, listServices } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { formatRole } from "./format";
import { membersHref } from "./member-paths";
import { useCan, useOrganization } from "./organization-scope";

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

/** One labelled part of the form: Who, Sign-in, Teams. */
function FormPart({
  title,
  aside,
  first = false,
  children,
}: {
  title: string;
  aside?: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cx(
        "flex flex-col gap-3",
        !first && "border-t border-line-subtle pt-4",
      )}
    >
      <h3 className="text-2xs font-semibold tracking-[0.08em] text-fg-subtle uppercase">
        {title}
        {aside && (
          <span className="font-normal tracking-normal normal-case">
            {" "}
            · {aside}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

/**
 * The four roles as cards to choose one of, none chosen to begin with:
 * giving someone a role is a decision, not a default. A hidden required
 * input stands for the choice, so the form's required fields count it.
 */
function RoleChoices({
  value,
  onChange,
  disabled,
}: {
  value: Role | null;
  onChange: (role: Role) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
      <legend className="sr-only">Role</legend>
      <input
        type="hidden"
        name="role"
        value={value ?? ""}
        required
        data-label="Role"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        {ROLE_ORDER.map((role) => {
          const meta = ROLE_META[role];
          const Icon = meta.icon;
          const checked = value === role;

          return (
            <label
              key={role}
              className={cx(
                "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-(--duration-fast)",
                checked
                  ? cx(meta.tone.subtle, meta.tone.line)
                  : "border-line bg-sunken hover:bg-hover",
              )}
            >
              <input
                type="radio"
                name="roleChoice"
                value={role}
                checked={checked}
                onChange={() => onChange(role)}
                className="mt-1 size-4 shrink-0 accent-accent-mark"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cx(
                    "flex items-center gap-1.5 text-sm font-semibold",
                    meta.tone.text,
                  )}
                >
                  <Icon aria-hidden="true" strokeWidth={2} className="size-4" />
                  {meta.label}
                </span>
                <span className="text-xs text-fg-muted">{meta.purpose}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Past this many teams, the cards can be searched. */
const SEARCH_FROM = 7;

/**
 * The organization's teams as cards to tick, all optional, each saying what
 * it owns — what choosing it means. Native checkboxes inside: a fieldset and
 * a legend are exactly the semantics a set of choices needs.
 *
 * However many teams there are, the dialog keeps its size: about two rows of
 * cards show, the rest scroll in place, and past six a search narrows them.
 * A choice is the form's state, not the card's, so a team searched out of
 * view stays chosen.
 */
function TeamChoices({
  chosen,
  onToggle,
  disabled,
}: {
  chosen: ReadonlySet<string>;
  onToggle: (teamId: string) => void;
  disabled: boolean;
}) {
  const organization = useOrganization();
  const teams = useTeams(organization.id);
  const canReadServices = useCan(Permission.SERVICES_READ);
  // The Services pages' own query, by key — asked only when it may be read.
  const services = useQuery({
    queryKey: queryKeys.services(organization.id),
    queryFn: () => listServices(organization.id),
    enabled: canReadServices,
  });
  const [query, setQuery] = useState("");
  const searchId = useId();

  if (teams.isError) return <ErrorAlert error={teams.error} />;
  if (!teams.data) return <Spinner label="Loading teams…" />;

  if (teams.data.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        There are no teams yet.{" "}
        <Link href={teamsHref(organization.slug)} className={linkClasses}>
          Create one
        </Link>{" "}
        to give people operational responsibility.
      </p>
    );
  }

  const searchable = teams.data.length >= SEARCH_FROM;
  const q = query.trim().toLowerCase();
  const shown = searchable
    ? teams.data.filter((team) => team.name.toLowerCase().includes(q))
    : teams.data;

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
      <legend className="sr-only">Teams</legend>
      {searchable && (
        <div className="relative sm:w-72">
          <label htmlFor={searchId} className="sr-only">
            Find a team
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a team"
            className="h-8 w-full rounded-md border border-line-control bg-field pr-2.5 pl-8 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          />
        </div>
      )}
      {/* About two rows of cards; the rest scroll here, not the dialog. */}
      <div
        role="region"
        aria-label="Teams to choose from"
        tabIndex={0}
        className="max-h-56 overflow-y-auto overscroll-contain rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:max-h-34"
      >
        {shown.length === 0 ? (
          <p className="px-1 py-2 text-sm text-fg-muted">
            No team matches &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {shown.map((team) => {
          const on = chosen.has(team.id);
          const owned = services.data
            ?.filter((service) => service.ownerTeam.id === team.id)
            .map(({ name }) => name);
          const members = `${team.memberCount} ${team.memberCount === 1 ? "member" : "members"}`;

          return (
            <label
              key={team.id}
              className={cx(
                "flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2.5 transition-colors duration-(--duration-fast) has-focus-visible:outline-2 has-focus-visible:outline-focus",
                on
                  ? "border-accent-line bg-accent-subtle"
                  : "border-line bg-field hover:bg-hover",
              )}
            >
              <span className="flex items-center gap-2">
                {/* Named by the team alone; what it owns describes it. */}
                <input
                  type="checkbox"
                  name="teamIds"
                  value={team.id}
                  checked={on}
                  onChange={() => onToggle(team.id)}
                  aria-labelledby={`${team.id}-name`}
                  aria-describedby={`${team.id}-detail`}
                  className="size-4 shrink-0 accent-accent-mark"
                />
                <span
                  id={`${team.id}-name`}
                  className="truncate text-sm font-semibold text-fg"
                >
                  {team.name}
                </span>
              </span>
              <span id={`${team.id}-detail`} className="text-xs text-fg-subtle">
                {owned === undefined
                  ? members
                  : `${owned.length === 0 ? "Owns no services yet" : `Owns ${owned.join(", ")}`} · ${members}`}
              </span>
            </label>
          );
        })}
      </div>
        )}
      </div>
    </fieldset>
  );
}

/** Copies the password, and says so for a moment. */
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), 2000);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="secondary"
      icon={copied ? Check : Copy}
      disabled={value === ""}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
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
          <span className="font-semibold">{added.name}</span> was added as{" "}
          {/^[AEIOU]/.test(formatRole(added.role)) ? "an" : "a"}{" "}
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
          <Button icon={Check} size="sm" onClick={onDone}>
            Done
          </Button>
          <Button icon={UserPlus} variant="add" size="sm" onClick={onAnother}>
            Add another
          </Button>
        </div>
      </div>
    </Alert>
  );
}

/**
 * The removed person an email belongs to, when adding them was refused for
 * it: read from the list, which whoever adds members is sent in full. The
 * list is read directly, not through the Members list's hook, which imports
 * this file.
 */
const useRemovedByEmail = (
  organizationId: string,
  email: string | undefined,
): OrganizationMembershipResponse | undefined => {
  const memberships = useQuery({
    queryKey: queryKeys.memberships(organizationId),
    queryFn: () => listMemberships(organizationId),
    enabled: email !== undefined,
  });
  const wanted = email?.trim().toLowerCase();

  return memberships.data?.find(
    (member) =>
      member.removal && member.user.email.toLowerCase() === wanted,
  );
};

function AddMemberForm({
  onAdded,
  onCancel,
  onRestore,
}: {
  onAdded: (added: Added) => void;
  onCancel: () => void;
  /** Their email is a removed person's: restore them instead. */
  onRestore: (member: OrganizationMembershipResponse) => void;
}) {
  const organization = useOrganization();
  const create = useCreateMember(organization.id);
  const wasRemoved =
    isApiError(create.error, 409) &&
    create.error.code === ApiErrorCode.MEMBER_REMOVED;
  const removed = useRemovedByEmail(
    organization.id,
    wasRemoved ? create.variables?.email : undefined,
  );
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(true);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [role, setRole] = useState<Role | null>(null);
  const teams = useTeams(organization.id);
  const { attach: requiredRef, ...required } = useRequiredFields(
    `${password}|${role ?? ""}`,
  );

  const toggle = (teamId: string) =>
    setChosen((current) => {
      const next = new Set(current);

      if (!next.delete(teamId)) next.add(teamId);

      return next;
    });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body: CreateMemberRequest = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      temporaryPassword: password,
      ...(role ? { role } : {}),
      // In the list's order, as they are shown, whatever order they were ticked.
      teamIds:
        teams.data?.filter(({ id }) => chosen.has(id)).map(({ id }) => id) ??
        [...chosen],
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
  const who = name.trim().split(/\s+/)[0] || "They";
  const chosenNames =
    teams.data
      ?.filter(({ id }) => chosen.has(id))
      .map(({ name: teamName }) => teamName) ?? [];

  return (
    <form
      ref={requiredRef}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
      <RequiredNote />
      {wasRemoved ? (
        <Alert
          tone="warning"
          title={
            removed
              ? `${removed.user.name} was removed from ${organization.name}.`
              : "This person was removed from the organization."
          }
        >
          <div className="flex flex-col items-start gap-2">
            <p className="text-fg-muted">
              Restore them instead: their history stays theirs, and they sign
              in with the password they already have.
            </p>
            {removed && (
              <Button variant="restore" icon={RotateCcw} size="sm" onClick={() => onRestore(removed)}>
                Restore {removed.user.name}
              </Button>
            )}
          </div>
        </Alert>
      ) : (
        create.isError && (
          <ErrorAlert error={create.error} message={messageFor(create.error)} />
        )
      )}

      <FormPart title="Who" first>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Name"
            name="name"
            autoComplete="off"
            placeholder="Full name"
            required
            onChange={(event) => setName(event.target.value)}
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
      </FormPart>

      <FormPart title="Role">
        <RoleChoices
          value={role}
          onChange={setRole}
          disabled={create.isPending}
        />
      </FormPart>

      <FormPart title="Sign-in">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-56 flex-1">
            <Field
              label="One-time password"
              name="temporaryPassword"
              type={shown ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              className="data"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              hint="At least 12 characters. They choose their own at first sign-in, so share this one privately."
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
      </FormPart>

      <FormPart
        title="Teams"
        aside={
          chosenNames.length > 0
            ? `optional · ${chosenNames.length} selected`
            : "optional"
        }
      >
        <TeamChoices
          chosen={chosen}
          onToggle={toggle}
          disabled={create.isPending}
        />
        {teams.data &&
          teams.data.length > 0 &&
          (chosenNames.length === 0 ? (
            // Only a Responder's work comes through their teams.
            role !== "RESPONDER" ? null : (
            <Alert tone="warning">
              With no team, {who === "They" ? "they" : who}&apos;ll see no
              incidents. You can add one later from the{" "}
              <Link
                href={membersHref(organization.slug)}
                className={linkClasses}
              >
                Members
              </Link>{" "}
              list.
            </Alert>
            )
          ) : (
            <p className="text-xs text-fg-subtle">
              {who} will respond to {chosenNames.join(", ")} incidents. Change
              teams later from the Members list.
            </p>
          ))}
      </FormPart>

      <DialogActions>
        <SubmitHint id={required.hintId} missing={required.missing} />
        <Button icon={X} variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button icon={UserPlus}
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
 * Adding a member, in a dialog over Members: who they are, a one-time
 * password to hand them, and optionally their teams. Once added, their
 * sign-in details replace the form; a stray click on the backdrop then does
 * not close it, since the password is shown only this once.
 */
export function AddMemberDialog({
  onClose,
  onRestore,
}: {
  onClose: () => void;
  /** Their email is a removed person's: restore them instead. */
  onRestore: (member: OrganizationMembershipResponse) => void;
}) {
  const [added, setAdded] = useState<Added | null>(null);
  // Remounted on "Add another", so the form starts empty.
  const [round, setRound] = useState(0);

  return (
    <FormDialog
      title="Add member"
      description="Create their account and hand them a one-time password."
      onClose={onClose}
      closeOnBackdrop={!added}
      size="lg"
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
        <AddMemberForm
          key={round}
          onAdded={setAdded}
          onCancel={onClose}
          onRestore={onRestore}
        />
      )}
    </FormDialog>
  );
}
