"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SettingRow } from "@/components/ui/setting-row";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type { OrganizationDetailResponse } from "@/lib/api/contracts";
import { updateOrganization } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { useCan, useOrganization } from "./organization-scope";

/**
 * The rename writes `name` only; the slug, and so every URL, is unchanged.
 *
 * What goes stale, judged from the response contracts:
 * - the organization detail's `name` — merged in from the response, which
 *   carries no membership, so the cached role and permissions are kept;
 * - `me`, whose memberships embed each organization's name for the picker
 *   and switcher — invalidated;
 * - the membership list carries no organization fields — left alone.
 */
export const useRenameOrganization = (organizationId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => updateOrganization(organizationId, { name }),
    onSuccess: (updated) => {
      queryClient.setQueryData<OrganizationDetailResponse>(
        queryKeys.organization(organizationId),
        (current) => (current ? { ...current, ...updated } : current),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.me,
        exact: true,
      });
    },
  });
};

export function RenameOrganizationForm() {
  const organization = useOrganization();
  const canUpdate = useCan(Permission.ORGANIZATION_UPDATE);
  const rename = useRenameOrganization(organization.id);
  const [saved, setSaved] = useState(false);

  if (!canUpdate) {
    return (
      <Alert tone="info">
        You do not have permission to change this organization&apos;s settings.
        The Admin can change them.
      </Alert>
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");

    setSaved(false);
    rename.mutate(name, { onSuccess: () => setSaved(true) });
  };

  const denied =
    isApiError(rename.error, 403) &&
    rename.error.code === ApiErrorCode.PERMISSION_DENIED;
  const fields = fieldErrorsOf(rename.error);

  return (
    <SettingRow
      title="Organization name"
      description={
        <p>
          Shown to members across SentinelOps. The URL name,{" "}
          <span className="data text-fg">{organization.slug}</span>, does not
          change, so existing links keep working.
        </p>
      }
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex max-w-md flex-col gap-4"
      >
        {rename.isError && (
          <ErrorAlert
            error={rename.error}
            message={
              denied
                ? "You do not have permission to rename this organization."
                : undefined
            }
          />
        )}
        {saved && <Alert tone="success">Organization renamed.</Alert>}
        <Field
          label="Name"
          name="name"
          defaultValue={organization.name}
          required
          maxLength={100}
          error={fields.name}
        />
        <div>
          <Button type="submit" disabled={rename.isPending}>
            {rename.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </SettingRow>
  );
}
