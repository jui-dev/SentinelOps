import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationScope } from "@/components/organizations/organization-scope";
import type { IncidentAnalysisResponse } from "@/lib/api/contracts";
import { SessionProvider } from "@/lib/auth/session-provider";
import { clearAccessToken } from "@/lib/auth/token-store";
import { createQueryClient } from "@/lib/query/query-client";
import { jsonResponse, route } from "@/test/api";

import {
  api,
  asMember,
  base,
  daniel,
  draft,
  inOrganization,
  resolvedIncident,
} from "./analysis.fixtures";
import { IncidentAnalysisPage } from "./incident-analysis-page";
import { useAnalysisDraft } from "./use-analysis-draft";

const navigation = vi.hoisted(() => ({
  params: { orgSlug: "acme-ops", incidentNumber: "42" },
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => `/orgs/acme-ops/incidents/${navigation.params.incidentNumber}/analysis`,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/** Two incidents' analyses, both Daniel's drafts, at the same version. */
const ANALYSES: Record<number, IncidentAnalysisResponse> = {
  42: draft({ version: 3, summary: "Card payments failed." }),
  43: draft({ version: 3, summary: "Logins failed." }),
};

/** Signed in as Daniel, with both incidents and their analyses to read. */
const asOwner = () => {
  const { permissions, handler } = asMember(daniel.id);

  return api(permissions, {
    handler: (request) => {
      const match = route(request).match(/^GET .*\/incidents\/(\d+)(\/analysis)?$/);

      if (match && ANALYSES[Number(match[1])]) {
        return match[2]
          ? jsonResponse(200, ANALYSES[Number(match[1])])
          : jsonResponse(200, resolvedIncident({ number: Number(match[1]) }));
      }
      if (route(request).startsWith(`GET ${base}/incidents/`)) {
        return jsonResponse(200, []);
      }
      return handler(request);
    },
  });
};

describe("a draft's identity", () => {
  beforeEach(() => {
    clearAccessToken();
    window.sessionStorage.clear();
    navigation.params = { orgSlug: "acme-ops", incidentNumber: "42" };
  });

  it("never carries one analysis's unsaved text into another's", async () => {
    asOwner();

    const queryClient = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <OrganizationScope>{children}</OrganizationScope>
        </SessionProvider>
      </QueryClientProvider>
    );

    // The same hook, never remounted, given another analysis.
    const { result, rerender } = renderHook(
      ({ number }: { number: number }) => useAnalysisDraft(ANALYSES[number], number),
      { wrapper, initialProps: { number: 42 } },
    );

    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current.change("cause", "A deploy on INC-42."));
    expect(result.current.dirty).toEqual(["cause"]);

    rerender({ number: 43 });

    expect(result.current.state.text.cause).toBe("");
    expect(result.current.state.text.summary).toBe("Logins failed.");
    expect(result.current.dirty).toEqual([]);

    // And INC-42's text is still kept for it.
    rerender({ number: 42 });

    expect(result.current.state.text.cause).toBe("A deploy on INC-42.");
    expect(result.current.restored).toBe(true);
  });

  it("restores an analysis's own unsaved text on returning to it from another", async () => {
    const user = userEvent.setup();

    asOwner();

    const page = inOrganization(<IncidentAnalysisPage />);
    // The same tree inOrganization renders, so only the address changes.
    const again = () =>
      page.rerender(
        <StrictMode>
          <QueryClientProvider client={page.queryClient}>
            <SessionProvider>
              <OrganizationScope>
                <IncidentAnalysisPage />
              </OrganizationScope>
            </SessionProvider>
          </QueryClientProvider>
        </StrictMode>,
      );

    await user.type(await screen.findByRole("textbox", { name: "Cause" }), "A deploy.");

    navigation.params = { orgSlug: "acme-ops", incidentNumber: "43" };
    again();

    await screen.findByDisplayValue("Logins failed.");
    expect(
      (screen.getByRole("textbox", { name: "Cause" }) as HTMLTextAreaElement).value,
    ).toBe("");

    navigation.params = { orgSlug: "acme-ops", incidentNumber: "42" };
    again();

    await screen.findByDisplayValue("Card payments failed.");
    expect(
      (screen.getByRole("textbox", { name: "Cause" }) as HTMLTextAreaElement).value,
    ).toBe("A deploy.");
    expect(
      screen.getByText("Your unsaved changes from earlier have been restored."),
    ).toBeDefined();
  });
});
