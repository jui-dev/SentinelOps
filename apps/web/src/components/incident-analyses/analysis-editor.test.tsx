import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IncidentAnalysisResponse } from "@/lib/api/contracts";
import { queryKeys } from "@/lib/api/query-keys";
import { clearAccessToken } from "@/lib/auth/token-store";
import { apiError, jsonResponse, organization, route } from "@/test/api";
import type { SentRequest } from "@/test/api";
import { expectNoAxeViolations } from "@/test/axe";

import {
  analysisPath,
  api,
  asMember,
  daniel,
  draft,
  inOrganization,
} from "./analysis.fixtures";
import { IncidentAnalysisPage } from "./incident-analysis-page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops", incidentNumber: "42" }),
  usePathname: () => "/orgs/acme-ops/incidents/42/analysis",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const STORED = `sentinelops.analysis-draft.${daniel.id}.42`;

/** The analysis as the server holds it now; tests move it on. */
let server: IncidentAnalysisResponse;

/** The server's analysis at its next version, with these changes. */
const next = (changes: Partial<IncidentAnalysisResponse>) => {
  server = {
    ...server,
    ...changes,
    version: server.version + 1,
    updatedAt: `2026-09-22T1${server.version}:00:00.000Z`,
  };

  return server;
};

/** Signed in as Daniel, who owns the draft, answering its writes with `write`. */
const asOwner = (write: (request: SentRequest) => Response | Promise<Response> | undefined = () => undefined) => {
  const { permissions, handler } = asMember(daniel.id);

  return api(permissions, {
    analysis: server,
    handler: (request) => {
      if (route(request) === `GET ${analysisPath}`) return jsonResponse(200, server);
      if (request.path === analysisPath && request.method === "PATCH") {
        return write(request) as Response | undefined;
      }
      return handler(request);
    },
  });
};

const field = (name: string) =>
  screen.findByRole("textbox", { name }) as Promise<HTMLTextAreaElement>;

const status = () =>
  within(screen.getByRole("region", { name: "Draft actions" })).getByRole("status");

/** The page asks the server again, as it does on returning to the tab. */
const refetch = (queryClient: import("@tanstack/react-query").QueryClient) =>
  act(() =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.incidentAnalysis(organization.id, 42),
    }),
  );

/** Resolves when told to: to act while a save is under way. */
const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

const saved = (request: SentRequest) => {
  const sections = { ...(request.body as Record<string, unknown>) };

  delete sections.version;

  return jsonResponse(
    200,
    next(
      Object.fromEntries(
        Object.entries(sections).map(([key, value]) => [key, value === "" ? null : value]),
      ),
    ),
  );
};

describe("writing an incident analysis", () => {
  beforeEach(() => {
    clearAccessToken();
    window.sessionStorage.clear();
    server = draft({ version: 3 });
  });

  describe("saving", () => {
    it("goes from clean to unsaved to saved, sending only what changed", async () => {
      const user = userEvent.setup();
      const { requests } = asOwner(saved);

      inOrganization(<IncidentAnalysisPage />);

      const cause = await field("Cause");

      expect(status().textContent).toMatch(/^All changes saved/);

      await user.type(cause, "A deploy removed a retry.");

      expect(status().textContent).toBe("Unsaved changes: Cause");
      expect(window.sessionStorage.getItem(STORED)).toContain("A deploy removed a retry.");

      await user.click(screen.getByRole("button", { name: "Save draft" }));

      await waitFor(() => expect(status().textContent).toMatch(/^All changes saved/));
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
        version: 3,
        cause: "A deploy removed a retry.",
      });
      expect(cause.value).toBe("A deploy removed a retry.");
      expect(window.sessionStorage.getItem(STORED)).toBeNull();
    });

    it("saves with Ctrl+S", async () => {
      const user = userEvent.setup();
      const { requests } = asOwner(saved);

      inOrganization(<IncidentAnalysisPage />);

      await user.type(await field("Lessons"), "Alert on duration.");
      await user.keyboard("{Control>}s{/Control}");

      await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    });

    it("keeps what was typed during a save unsaved afterwards", async () => {
      const user = userEvent.setup();
      const answer = deferred();
      let sent: SentRequest | undefined;

      asOwner((request) => {
        sent = request;
        return answer.promise as unknown as Response;
      });

      inOrganization(<IncidentAnalysisPage />);

      const cause = await field("Cause");

      await user.type(cause, "A deploy.");
      await user.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => expect(status().textContent).toBe("Saving…"));

      await user.type(cause, " Rolled back.");
      await act(async () => answer.resolve(saved(sent!)));

      await waitFor(() => expect(status().textContent).toBe("Unsaved changes: Cause"));
      expect(cause.value).toBe("A deploy. Rolled back.");
      expect(screen.queryByText(/Someone else saved/)).toBeNull();
    });

    it("never loses text when a save fails, and offers to try again", async () => {
      const user = userEvent.setup();

      asOwner(() => apiError(500));

      inOrganization(<IncidentAnalysisPage />);

      const cause = await field("Cause");

      await user.type(cause, "A deploy.");
      await user.click(screen.getByRole("button", { name: "Save draft" }));

      await waitFor(() =>
        expect(status().textContent).toBe("Couldn't save. Your text is still here."),
      );
      expect(cause.value).toBe("A deploy.");
      expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
      expect(window.sessionStorage.getItem(STORED)).toContain("A deploy.");
    });
  });

  describe("discarding", () => {
    it("always asks first, even for one section, and clears what was kept", async () => {
      const user = userEvent.setup();

      asOwner();

      inOrganization(<IncidentAnalysisPage />);

      const cause = await field("Cause");

      await user.type(cause, "A deploy.");
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      const dialog = await screen.findByRole("dialog", {
        name: "Discard your unsaved changes?",
      });

      await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
      expect(cause.value).toBe("A deploy.");

      await user.click(screen.getByRole("button", { name: "Discard changes" }));
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Discard changes",
        }),
      );

      expect(cause.value).toBe("");
      expect(window.sessionStorage.getItem(STORED)).toBeNull();
    });
  });

  describe("leaving and coming back", () => {
    it("restores unsaved text on return", async () => {
      const user = userEvent.setup();

      asOwner();

      const first = inOrganization(<IncidentAnalysisPage />);

      await user.type(await field("Cause"), "A deploy.");
      first.unmount();

      inOrganization(<IncidentAnalysisPage />);

      expect((await field("Cause")).value).toBe("A deploy.");
      expect(
        screen.getByText("Your unsaved changes from earlier have been restored."),
      ).toBeDefined();
    });

    it("restores it through reconciliation when the analysis moved meanwhile", async () => {
      const user = userEvent.setup();

      asOwner();

      const first = inOrganization(<IncidentAnalysisPage />);

      await user.type(await field("Cause"), "A deploy.");
      first.unmount();
      next({ impact: "Two hours.", cause: "A config change." });

      inOrganization(<IncidentAnalysisPage />);

      expect((await field("Cause")).value).toBe("A deploy.");
      expect((await field("Impact")).value).toBe("Two hours.");
      expect(screen.getByText("Someone else saved a different Cause.")).toBeDefined();
      expect(screen.getByRole("button", { name: "Save draft" })).toHaveProperty("disabled", true);
    });

    it("asks before the tab closes only while there is unsaved text", async () => {
      const user = userEvent.setup();

      asOwner();

      inOrganization(<IncidentAnalysisPage />);

      const leave = () => {
        const event = new Event("beforeunload", { cancelable: true });

        window.dispatchEvent(event);
        return event.defaultPrevented;
      };

      const cause = await field("Cause");

      expect(leave()).toBe(false);
      await user.type(cause, "A deploy.");
      expect(leave()).toBe(true);
    });
  });

  describe("when the analysis changes meanwhile", () => {
    it("merges a change to another section after a refused save, and saves again", async () => {
      const user = userEvent.setup();
      let refused = false;
      const { requests } = asOwner((request) => {
        if (refused) return saved(request);
        refused = true;
        next({ impact: "Two hours." });
        return apiError(409, "ANALYSIS_CHANGED");
      });

      inOrganization(<IncidentAnalysisPage />);

      const cause = await field("Cause");

      await user.type(cause, "A deploy.");
      await user.click(screen.getByRole("button", { name: "Save draft" }));

      expect(
        await screen.findByText("Someone saved changes to this analysis while you were editing."),
      ).toBeDefined();
      await waitFor(async () => expect((await field("Impact")).value).toBe("Two hours."));
      expect(cause.value).toBe("A deploy.");

      await user.click(screen.getByRole("button", { name: "Save draft" }));

      await waitFor(() => expect(status().textContent).toMatch(/^All changes saved/));
      expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toEqual({
        version: 4,
        cause: "A deploy.",
      });
    });

    it("asks where both changed the same section, and saves the writer's choice", async () => {
      const user = userEvent.setup();
      const { requests, queryClient } = {
        ...asOwner(saved),
        ...inOrganization(<IncidentAnalysisPage />),
      };

      const cause = await field("Cause");

      await user.type(cause, "A deploy.");
      next({ cause: "A config change." });
      await refetch(queryClient);

      const notice = await screen.findByText("Someone else saved a different Cause.");

      expect(cause.value).toBe("A deploy.");
      expect(screen.getByRole("button", { name: "Save draft" })).toHaveProperty("disabled", true);

      await user.click(
        within(notice.closest('[role="status"]') as HTMLElement).getByRole("button", {
          name: "Keep my text",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Save draft" }));

      await waitFor(() =>
        expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toEqual({
          version: 4,
          cause: "A deploy.",
        }),
      );
    });

    it("takes the saved text when the writer chooses it", async () => {
      const user = userEvent.setup();

      asOwner();

      const { queryClient } = inOrganization(<IncidentAnalysisPage />);
      const cause = await field("Cause");

      await user.type(cause, "A deploy.");
      next({ cause: "A config change." });
      await refetch(queryClient);

      await user.click(await screen.findByRole("button", { name: "Use saved text" }));

      expect(cause.value).toBe("A config change.");
      expect(status().textContent).toMatch(/^All changes saved/);
    });

    it("adopts a later version silently when nothing is unsaved", async () => {
      asOwner();

      const { queryClient } = inOrganization(<IncidentAnalysisPage />);

      await field("Cause");
      next({ cause: "A config change." });
      await refetch(queryClient);

      await waitFor(async () => expect((await field("Cause")).value).toBe("A config change."));
      expect(screen.queryByText(/Someone saved changes/)).toBeNull();
    });
  });

  describe("when editing is no longer possible", () => {
    it("keeps unsaved text to copy when the analysis is published meanwhile", async () => {
      const user = userEvent.setup();

      asOwner();

      const { queryClient } = inOrganization(<IncidentAnalysisPage />);

      await user.type(await field("Cause"), "A deploy.");
      next({
        status: "PUBLISHED",
        publishedBy: { id: "0199a1b2-c3d4-7000-8000-000000000001", name: "Ada Lovelace" },
        publishedAt: "2026-09-22T14:10:00.000Z",
      });
      await refetch(queryClient);

      const reason = await screen.findByText(
        "This analysis was published by Ada Lovelace while you were editing. Your unsaved changes weren't included.",
      );

      expect(screen.queryByRole("form", { name: "Analysis" })).toBeNull();
      expect(screen.getByText("This analysis is final. It is kept as published.")).toBeDefined();
      expect(
        (screen.getByRole("textbox", { name: "Cause" }) as HTMLTextAreaElement).readOnly,
      ).toBe(true);
      expect((screen.getByRole("textbox", { name: "Cause" }) as HTMLTextAreaElement).value).toBe(
        "A deploy.",
      );
      expect(reason.closest('[tabindex="-1"]')).toBe(document.activeElement);
      expect(window.sessionStorage.getItem(STORED)).toContain("A deploy.");
    });

    it("keeps unsaved text to copy when ownership moves and a save is refused", async () => {
      const user = userEvent.setup();

      asOwner(() => {
        next({ owner: { membershipId: "0199a1b2-c3d4-7000-8000-0000000000ac", name: "Sam Okafor" } });
        return apiError(403, "NOT_ANALYSIS_OWNER");
      });

      inOrganization(<IncidentAnalysisPage />);

      await user.type(await field("Cause"), "A deploy.");
      await user.click(screen.getByRole("button", { name: "Save draft" }));

      expect(
        await screen.findByText("Sam Okafor now owns this analysis, so you can no longer edit it."),
      ).toBeDefined();
      expect(screen.queryByRole("region", { name: "Draft actions" })).toBeNull();
      expect(
        (screen.getByRole("textbox", { name: "Cause" }) as HTMLTextAreaElement).value,
      ).toBe("A deploy.");
    });
  });

  describe("accessibility", () => {
    it("has no violations while unsaved, in conflict, or kept to copy", async () => {
      const user = userEvent.setup();

      asOwner();

      const { container, queryClient } = inOrganization(<IncidentAnalysisPage />);

      await user.type(await field("Cause"), "A deploy.");
      await expectNoAxeViolations(container);

      next({ cause: "A config change." });
      await refetch(queryClient);
      await screen.findByText("Someone else saved a different Cause.");
      await expectNoAxeViolations(container);

      next({
        status: "PUBLISHED",
        publishedBy: { id: "0199a1b2-c3d4-7000-8000-000000000001", name: "Ada Lovelace" },
        publishedAt: "2026-09-22T14:10:00.000Z",
      });
      await refetch(queryClient);
      await screen.findByText(/Your unsaved changes weren't included/);
      await expectNoAxeViolations(container);
    });
  });
});
