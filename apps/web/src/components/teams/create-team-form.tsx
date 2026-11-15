"use client";

import {
  Plus,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormExample } from "@/components/ui/form-example";
import {
  RequiredNote,
  SubmitHint,
  useRequiredFields,
} from "@/components/ui/required";
import { ApiErrorCode } from "@/lib/api/contracts";
import type { CreateTeamRequest, TeamResponse } from "@/lib/api/contracts";
import { createTeam } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

export const NAME_TAKEN_MESSAGE =
  "A team with this name, or a very similar one, already exists.";

const TEAM_EXAMPLE = [
  { label: "Name", value: "Payments" },
  { label: "Description", value: "Keeps card payments and payouts running." },
];

/**
 * Creates a team. The new team is put into the cached list, so the list
 * behind the dialog shows it without waiting for a refetch.
 */
const useCreateTeam = (organizationId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateTeamRequest) => createTeam(organizationId, body),
    onSuccess: (created) => {
      queryClient.setQueryData<TeamResponse[]>(
        queryKeys.teams(organizationId),
        (current) => (current ? [...current, created] : current),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teams(organizationId),
        exact: true,
      });
    },
  });
};

/** Creating a team, in the Teams page's dialog. Creating closes it. */
export function CreateTeamForm({ onClose }: { onClose: () => void }) {
  const organization = useOrganization();
  const create = useCreateTeam(organization.id);
  const { attach: requiredRef, ...required } = useRequiredFields();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    create.mutate(
      {
        name: String(data.get("name") ?? ""),
        description: String(data.get("description") ?? ""),
      },
      { onSuccess: onClose },
    );
  };

  const nameTaken =
    isApiError(create.error, 409) &&
    create.error.code === ApiErrorCode.TEAM_NAME_TAKEN;
  const fields = fieldErrorsOf(create.error);

  return (
    <form
      ref={requiredRef}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
      <FormExample fields={TEAM_EXAMPLE} />
      <RequiredNote />
      {create.isError && !nameTaken && Object.keys(fields).length === 0 && (
        <ErrorAlert error={create.error} />
      )}
      <Field
        label="Name"
        name="name"
        required
        maxLength={100}
        autoComplete="off"
        error={nameTaken ? NAME_TAKEN_MESSAGE : fields.name}
      />
      <Field
        label="Description"
        name="description"
        optional
        maxLength={500}
        autoComplete="off"
        hint="What the team is responsible for."
        error={fields.description}
      />
      <DialogActions>
        <SubmitHint id={required.hintId} missing={required.missing} />
        <Button icon={X} variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button icon={Plus}
          type="submit"
          disabled={create.isPending || !required.ready}
          aria-describedby={required.ready ? undefined : required.hintId}
        >
          {create.isPending ? "Creating…" : "Create team"}
        </Button>
      </DialogActions>
    </form>
  );
}
