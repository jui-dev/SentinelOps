import { organizationPath } from "@/components/app/navigation";

/** Where the member pages live, in one place for every page that links to them. */
export const membersHref = (orgSlug: string) =>
  `${organizationPath(orgSlug)}/members`;

export const addMemberHref = (orgSlug: string) =>
  `${membersHref(orgSlug)}/new`;

export const memberHref = (orgSlug: string, membershipId: string) =>
  `${membersHref(orgSlug)}/${encodeURIComponent(membershipId)}`;
