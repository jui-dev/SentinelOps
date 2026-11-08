import type { IncidentResponse } from "@/lib/api/contracts";

import { SEVERITY_LEVELS } from "./severity";

/**
 * Small figures read from a page of incidents, for the glance tiles on a
 * team's and a service's pages — the same words on both.
 */

/** A page's count, honest about a first page that is not the whole list. */
export const countOf = (items: readonly unknown[], hasMore: boolean) =>
  hasMore ? `${items.length}+` : String(items.length);

/** The most severe level among the incidents, and how many have it. */
export const worstOf = (incidents: readonly IncidentResponse[]) => {
  for (const { value } of SEVERITY_LEVELS) {
    const count = incidents.filter((each) => each.severity === value).length;

    if (count > 0) return `${count} × ${value}`;
  }

  return undefined;
};
