"use client";

import Link from "next/link";

import { ErrorAlert } from "@/components/ui/alert";
import { PageSpinner } from "@/components/ui/spinner";
import { useCurrentUser } from "@/lib/auth/session-provider";

import { formatRole } from "./format";

export function OrganizationPicker() {
  const me = useCurrentUser();

  if (me.isError) return <ErrorAlert error={me.error} />;
  if (!me.data) return <PageSpinner />;

  const { memberships } = me.data;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Your organizations</h1>
      {memberships.length === 0 ? (
        <p className="text-sm text-slate-600">
          You are not a member of any organization.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {memberships.map(({ id, role, organization }) => (
            <li key={id}>
              <Link
                href={`/orgs/${encodeURIComponent(organization.slug)}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50"
              >
                <span className="font-medium">{organization.name}</span>
                <span className="text-sm text-slate-500">
                  {formatRole(role)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
