"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { DemoPart, DemoWorkspaceResponse } from "@/lib/api/contracts";
import {
  generateDemoPart,
  getDemoWorkspace,
  removeDemoData,
  removeDemoPart,
  resetDemo,
} from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

/** A demo organization's parts: asked only of a demo, by its Admin. */
export const useDemoWorkspace = (organizationId: string, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.demoWorkspace(organizationId),
    queryFn: () => getDemoWorkspace(organizationId),
    enabled,
  });

export type DemoAction =
  | { kind: "generate"; part: DemoPart }
  | { kind: "remove"; part: DemoPart }
  | { kind: "reset" }
  | { kind: "removeAll" };

const run = (organizationId: string, action: DemoAction) => {
  switch (action.kind) {
    case "generate":
      return generateDemoPart(organizationId, action.part);
    case "remove":
      return removeDemoPart(organizationId, action.part);
    case "reset":
      return resetDemo(organizationId);
    case "removeAll":
      return removeDemoData(organizationId);
  }
};

/**
 * One change to the demo. Its answer is the workspace as it now stands; and
 * since a change can touch anything in the organization — its incidents,
 * teams, services, log — everything cached under it is read again.
 */
export const useDemoAction = (organizationId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (action: DemoAction) => run(organizationId, action),
    onSuccess: (workspace: DemoWorkspaceResponse) => {
      queryClient.setQueryData(queryKeys.demoWorkspace(organizationId), workspace);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.organization(organizationId),
        predicate: (query) => query.queryKey[2] !== "demo",
      });
    },
  });
};
