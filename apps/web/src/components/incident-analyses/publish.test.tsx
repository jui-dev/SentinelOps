import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IncidentAnalysisResponse } from "@/lib/api/contracts";
import { queryKeys } from "@/lib/api/query-keys";
import { clearAccessToken } from "@/lib/auth/token-store";
import { apiError, jsonResponse, organization, route } from "@/test/api";
import type { SentRequest } from "@/test/api";
import { expectNoAxeViolations } from "@/test/axe";

import { analysisPath, api, asMember, daniel, draft, inOrganization } from "./analysis.fixtures";
import { IncidentAnalysisPage } from "./incident-analysis-page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops", incidentNumber: "42" }),
  usePathname: () => "/orgs/acme-ops/incidents/42/analysis",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const ada = { id: "0199a1b2-c3d4-7000-8000-000000000001", name: "Ada Lovelace" };

/** The analysis as the server holds it now; tests move it on. */
let server: IncidentAnalysisResponse;

const next = (changes: Partial<IncidentAnalysisResponse>) => {
  server = { ...server, ...changes, version: server.version + 1 };

  return server;
};

const publishedBy = (by: typeof ada) =>
  next({ status: "PUBLISHED", publishedBy: by, publishedAt: "2026-09-22T14:10:00.000Z" });

/** Signed in as Daniel, who owns the draft, answering a publication with `publish`. */
const asOwner = (publish: (request: SentRequest) => Response = () => jsonResponse(200, publishedBy(ada))) => {
  const { permissions, handler } = asMember(daniel.id);

  return api(permissions, {
    analysis: server,
    handler: (request) => {
      if (route(request) === `GET ${analysisPath}`) return jsonResponse(200, server);
      if (route(request) === `POST ${analysisPath}/publish`) return publish(request);
      return handler(request);
    },
  });
};

const publishButton = () => screen.findByRole("button", { name: "Publish…" });

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await publishButton());

  return screen.findByRole("dialog", { name: "Publish this analysis?" });
};

describe("publishing an incident analysis", () => {
  beforeEach(() => {
    clearAccessToken();
    window.sessionStorage.clear();
    server = draft({ version: 3, doneSections: ["summary", "impact"] });
  });

  describe("when it can be published", () => {
    it("waits for unsaved text to be saved, and says so", async () => {
      const user = userEvent.setup();

      asOwner();
      inOrganization(<IncidentAnalysisPage />);

      const publish = await publishButton();

      expect(publish).toHaveProperty("disabled", false);

      await user.type(await screen.findByRole("textbox", { name: "Cause" }), "A deploy.");

      expect(publish).toHaveProperty("disabled", true);
      expect(publish.getAttribute("aria-describedby")).toBeTruthy();
      expect(
        document.getElementById(publish.getAttribute("aria-describedby")!)?.textContent,
      ).toBe("Save before publishing — only saved text is published.");
    });

    it("waits for a summary marked done, and says so", async () => {
      server = draft({ version: 3, summary: null, doneSections: [] });
      asOwner();
      inOrganization(<IncidentAnalysisPage />);

      const publish = await publishButton();

      expect(publish).toHaveProperty("disabled", true);
      expect(screen.getByText("Mark the summary as done to publish.")).toBeDefined();
    });
  });

  describe("confirming", () => {
    it("shows what will be published, the empty sections as left out", async () => {
      const user = userEvent.setup();

      asOwner();
      inOrganization(<IncidentAnalysisPage />);

      const dialog = await openDialog(user);

      expect(dialog.textContent).toContain(
        "INC-42's published analysis is final and is kept as it is.",
      );
      expect(
        within(within(dialog).getByRole("list", { name: "What will be published" }))
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual([
        "SummaryDone",
        "ImpactDone",
        "CauseBlank, left out",
        "LessonsBlank, left out",
      ]);
      await expectNoAxeViolations(dialog);
    });

    it("publishes the saved version, and the page becomes the published record", async () => {
      const user = userEvent.setup();
      const { requests } = asOwner();

      inOrganization(<IncidentAnalysisPage />);

      const dialog = await openDialog(user);

      await user.click(within(dialog).getByRole("button", { name: "Publish analysis" }));

      const notice = await screen.findByText("Analysis published.");

      expect(requests.find((r) => route(r) === `POST ${analysisPath}/publish`)?.body).toEqual({
        version: 3,
      });
      expect(screen.queryByRole("region", { name: "Draft actions" })).toBeNull();
      expect(screen.getByText("This analysis is final. It is kept as published.")).toBeDefined();
      expect(notice.closest('[tabindex="-1"]')).toBe(document.activeElement);
    });
  });

  describe("when it is refused", () => {
    it("takes in someone else's change and asks for a review, without publishing", async () => {
      const user = userEvent.setup();
      let attempts = 0;

      asOwner(() => {
        attempts += 1;
        next({ cause: "A config change." });
        return apiError(409, "ANALYSIS_CHANGED");
      });
      inOrganization(<IncidentAnalysisPage />);

      const dialog = await openDialog(user);

      await user.click(within(dialog).getByRole("button", { name: "Publish analysis" }));

      expect(await screen.findByText("Their changes are in. Review them before publishing.")).toBeDefined();
      await waitFor(async () =>
        expect(
          ((await screen.findByRole("textbox", { name: "Cause" })) as HTMLTextAreaElement).value,
        ).toBe("A config change."),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(attempts).toBe(1);
    });

    it("closes without publishing when a later version arrives while it is open", async () => {
      const user = userEvent.setup();
      const { requests } = asOwner();
      const { queryClient } = inOrganization(<IncidentAnalysisPage />);

      await openDialog(user);
      next({ impact: "Two hours." });
      await act(() =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.incidentAnalysis(organization.id, 42),
        }),
      );

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getByText("Their changes are in. Review them before publishing.")).toBeDefined();
      expect(requests.some((r) => route(r) === `POST ${analysisPath}/publish`)).toBe(false);
    });

    it("says someone else published it first", async () => {
      const user = userEvent.setup();
      const sam = { id: "0199a1b2-c3d4-7000-8000-000000000003", name: "Sam Okafor" };

      asOwner(() => {
        publishedBy(sam);
        return apiError(409, "ANALYSIS_PUBLISHED");
      });
      inOrganization(<IncidentAnalysisPage />);

      await user.click(
        within(await openDialog(user)).getByRole("button", { name: "Publish analysis" }),
      );

      expect(await screen.findByText("Sam Okafor published this analysis first.")).toBeDefined();
      expect(screen.getByText("This analysis is final. It is kept as published.")).toBeDefined();
    });

    it("says the analysis is no longer theirs to publish", async () => {
      const user = userEvent.setup();

      asOwner(() => {
        next({ owner: { membershipId: "0199a1b2-c3d4-7000-8000-0000000000ac", name: "Sam Okafor" } });
        return apiError(403, "NOT_ANALYSIS_OWNER");
      });
      inOrganization(<IncidentAnalysisPage />);

      await user.click(
        within(await openDialog(user)).getByRole("button", { name: "Publish analysis" }),
      );

      expect(
        await screen.findByText("Sam Okafor now owns this analysis, so you can no longer publish it."),
      ).toBeDefined();
      expect(screen.queryByRole("region", { name: "Draft actions" })).toBeNull();
    });

    it("keeps publishing blocked if the API finds no summary", async () => {
      const user = userEvent.setup();

      asOwner(() => apiError(409, "ANALYSIS_SUMMARY_REQUIRED"));
      inOrganization(<IncidentAnalysisPage />);

      const dialog = await openDialog(user);

      await user.click(within(dialog).getByRole("button", { name: "Publish analysis" }));

      expect(
        await within(dialog).findByText("Mark the summary as done before publishing."),
      ).toBeDefined();
      expect(within(dialog).getByRole("button", { name: "Publish analysis" })).toHaveProperty(
        "disabled",
        true,
      );
    });
  });
});
