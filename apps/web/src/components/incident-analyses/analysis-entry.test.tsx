import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IncidentDetail } from "@/components/incidents/incident-detail";
import { clearAccessToken } from "@/lib/auth/token-store";
import { apiError, jsonResponse, route } from "@/test/api";

import {
  ADMIN,
  MEMBER,
  READ_ONLY,
  ada,
  analysisHref,
  analysisPath,
  api,
  asMember,
  base,
  daniel,
  draft,
  inOrganization,
  published,
  resolvedIncident,
  sam,
} from "./analysis.fixtures";
import { IncidentAnalysisPage } from "./incident-analysis-page";

const navigation = vi.hoisted(() => ({
  params: { orgSlug: "acme-ops", incidentNumber: "42" } as {
    orgSlug: string;
    incidentNumber: string;
  },
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => "/orgs/acme-ops/incidents/42",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: navigation.push }),
}));

/** The entry panel, once it has said something — "Next step: …" when it is the caller's. */
const entry = async () =>
  (await screen.findByRole("heading", { name: /Incident analysis$/ })).closest(
    "section",
  ) as HTMLElement;

describe("incident analysis", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.params = { orgSlug: "acme-ops", incidentNumber: "42" };
    navigation.push.mockReset();
  });

  describe("on the incident", () => {
    it("is not asked about while the incident is active", async () => {
      const { requests } = api(ADMIN, {
        detail: resolvedIncident({
          status: "INVESTIGATING",
          resolvedAt: null,
          resolution: null,
        }),
      });

      inOrganization(<IncidentDetail />);

      await screen.findByRole("heading", { name: /Timeline/ });
      expect(screen.queryByRole("heading", { name: /Incident analysis$/ })).toBeNull();
      expect(requests.some((r) => r.path === analysisPath)).toBe(false);
    });

    it("sits beneath the resolution", async () => {
      api(READ_ONLY);

      inOrganization(<IncidentDetail />);

      const panel = await entry();
      const resolution = (
        await screen.findByRole("heading", { name: "Resolution" })
      ).closest("section") as HTMLElement;

      expect(resolution.nextElementSibling).toBe(panel);
    });

    it("offers the admin a start when none has been started", async () => {
      api(ADMIN);

      inOrganization(<IncidentDetail />);

      expect(await screen.findByText("Start the analysis.")).toBeDefined();

      const ready = await entry();

      // Starting it is the Admin's next step, and says so.
      expect(within(ready).getByRole("heading").textContent).toMatch(/^Next step/);
      expect(within(ready).getByRole("button", { name: "Start analysis" })).toBeDefined();
      // The four sections it will hold, none written.
      expect(
        within(within(ready).getByRole("list", { name: "Analysis sections" }))
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual([
        expect.stringMatching(/^1Summary required to publish.*write this first$/),
        expect.stringMatching(/^2Impact optional.*not written$/),
        expect.stringMatching(/^3Cause optional.*not written$/),
        expect.stringMatching(/^4Lessons optional.*not written$/),
      ]);
    });

    it.each([
      ["a member", MEMBER],
      ["a reader", READ_ONLY],
    ])("tells %s none has been started, with nothing to do", async (_, permissions) => {
      api(permissions);

      inOrganization(<IncidentDetail />);

      const panel = await entry();

      expect(await within(panel).findByText("No analysis yet.")).toBeDefined();
      // Not theirs to start: no "next step", and nothing to press.
      expect(within(panel).getByRole("heading").textContent).toBe("Incident analysis");
      expect(within(panel).queryByRole("button")).toBeNull();
      expect(within(panel).queryByRole("link")).toBeNull();
    });

    it("shows a draft's owner and progress, and lets its owner open it", async () => {
      const { permissions, handler } = asMember(daniel.id);

      api(permissions, { analysis: draft(), handler });

      inOrganization(<IncidentDetail />);

      const panel = await entry();
      // The summary is written, so the next step is to review and publish.
      const link = await within(panel).findByRole("link", { name: "Review and publish" });

      expect(link.getAttribute("href")).toBe(analysisHref);
      expect(within(panel).getByText("Ready to publish.")).toBeDefined();
      expect(within(panel).getByText("Draft")).toBeDefined();
      expect(panel.textContent).toContain("owned by you");
      expect(panel.textContent).toContain("2 of 4 sections written");
      expect(
        within(within(panel).getByRole("list", { name: "Analysis sections" }))
          .getAllByRole("listitem")
          .map((item) => item.textContent?.match(/(written|not written)$/)?.[0]),
      ).toEqual(["written", "written", "not written", "not written"]);
    });

    it("lets the admin open a draft someone else owns", async () => {
      api(ADMIN, { analysis: draft() });

      inOrganization(<IncidentDetail />);

      const panel = await entry();

      expect(
        await within(panel).findByRole("link", { name: "Review and publish" }),
      ).toBeDefined();
      expect(panel.textContent).toContain("owned by Daniel Okafor");
    });

    it("lets a member who does not own a draft read it", async () => {
      const { permissions, handler } = asMember(sam.id);

      api(permissions, { analysis: draft(), handler });

      inOrganization(<IncidentDetail />);

      const panel = await entry();
      const link = await within(panel).findByRole("link", { name: "Read draft" });

      expect(within(panel).getByText("Being written by Daniel Okafor.")).toBeDefined();
      expect(within(panel).getByRole("heading").textContent).toBe("Incident analysis");

      expect(link.getAttribute("href")).toBe(analysisHref);
      expect(within(panel).queryByRole("button")).toBeNull();
    });

    it("leads a published analysis with its publication, then its summary and owner", async () => {
      api(READ_ONLY, { analysis: published() });

      inOrganization(<IncidentDetail />);

      const panel = await entry();
      const link = await within(panel).findByRole("link", { name: "Read analysis" });

      expect(link.getAttribute("href")).toBe(analysisHref);
      expect(within(panel).getByText("Analysis published.")).toBeDefined();
      // When, and by whom; then its summary. Nothing left to write.
      expect(panel.querySelector("time")?.getAttribute("dateTime")).toBe(
        "2026-09-22T14:10:00.000Z",
      );
      expect(panel.textContent).toContain("by Ada Lovelace");
      expect(within(panel).getByText("Card payments failed after a deploy.")).toBeDefined();
      expect(within(panel).queryByRole("list", { name: "Analysis sections" })).toBeNull();
    });

    it("keeps an analysis that cannot be loaded to itself", async () => {
      api(ADMIN, {
        handler: (request) =>
          request.path === analysisPath
            ? apiError(403, "PERMISSION_DENIED")
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const panel = await entry();

      expect(await within(panel).findByRole("alert")).toBeDefined();
      expect(within(panel).queryByRole("button", { name: "Start analysis" })).toBeNull();
      expect(screen.getByRole("heading", { name: /Timeline/ })).toBeDefined();
    });
  });

  describe("starting one", () => {
    const openStart = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: "Start analysis" }));

      const dialog = await screen.findByRole("dialog", { name: "Start analysis" });

      return {
        dialog,
        owner: (await within(dialog).findByLabelText("Owner")) as HTMLSelectElement,
      };
    };

    it("offers the caller first, with those who responded grouped ahead of everyone else", async () => {
      const user = userEvent.setup();

      api(ADMIN);
      inOrganization(<IncidentDetail />);

      const { owner } = await openStart(user);

      expect(owner.value).toBe(ada.id);

      const [responded, everyone] = within(owner).getAllByRole("group");

      expect(responded.getAttribute("label")).toBe("Responded to INC-42");
      expect(
        within(responded).getAllByRole("option").map((o) => o.textContent),
      ).toEqual(["Daniel Okafor (daniel@example.test)"]);
      expect(everyone.getAttribute("label")).toBe("Everyone else");
      expect(
        within(everyone).getAllByRole("option").map((o) => o.textContent),
      ).toEqual(["Ada Lovelace (you)", "Sam Okafor (sam@example.test)"]);
    });

    it("sends nothing when the caller keeps it, and opens the analysis once started", async () => {
      const user = userEvent.setup();
      const { requests } = api(ADMIN, {
        handler: (request) =>
          route(request) === `POST ${analysisPath}`
            ? jsonResponse(201, draft({ owner: { membershipId: ada.id, name: "Ada Lovelace" } }))
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const { dialog } = await openStart(user);

      await user.click(within(dialog).getByRole("button", { name: "Start analysis" }));

      await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(analysisHref));

      const post = requests.find((r) => route(r) === `POST ${analysisPath}`)!;

      expect(post.body).toBeUndefined();
    });

    it("names the owner chosen", async () => {
      const user = userEvent.setup();
      const { requests } = api(ADMIN, {
        handler: (request) =>
          route(request) === `POST ${analysisPath}`
            ? jsonResponse(201, draft())
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const { dialog, owner } = await openStart(user);

      await user.selectOptions(owner, daniel.id);
      await user.click(within(dialog).getByRole("button", { name: "Start analysis" }));

      await waitFor(() => expect(navigation.push).toHaveBeenCalled());
      expect(
        requests.find((r) => route(r) === `POST ${analysisPath}`)!.body,
      ).toEqual({ ownerMembershipId: daniel.id });
    });

    it("explains that someone else started it first, and shows theirs", async () => {
      const user = userEvent.setup();
      let started = false;

      api(ADMIN, {
        handler: (request) => {
          if (route(request) === `POST ${analysisPath}`) {
            started = true;
            return apiError(409, "ANALYSIS_ALREADY_STARTED");
          }
          if (route(request) === `GET ${analysisPath}` && started) {
            return jsonResponse(200, draft());
          }
          return undefined;
        },
      });

      inOrganization(<IncidentDetail />);

      const { dialog } = await openStart(user);

      await user.click(within(dialog).getByRole("button", { name: "Start analysis" }));

      expect(
        await within(dialog).findByText(/Someone else started this analysis a moment ago/),
      ).toBeDefined();
      await user.click(within(dialog).getByRole("button", { name: "Done" }));

      const panel = await entry();

      expect(
        await within(panel).findByRole("link", { name: "Review and publish" }),
      ).toBeDefined();
      expect(navigation.push).not.toHaveBeenCalled();
    });

    it("says when the owner chosen is no longer a member", async () => {
      const user = userEvent.setup();

      api(ADMIN, {
        handler: (request) =>
          route(request) === `POST ${analysisPath}`
            ? apiError(404, "MEMBERSHIP_NOT_FOUND")
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const { dialog, owner } = await openStart(user);

      await user.selectOptions(owner, sam.id);
      await user.click(within(dialog).getByRole("button", { name: "Start analysis" }));

      expect(
        await within(dialog).findByText(/no longer a member of this organization/),
      ).toBeDefined();
      expect(owner.getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("its page", () => {
    it("leads back to its incident", async () => {
      api(READ_ONLY, { analysis: draft() });

      inOrganization(<IncidentAnalysisPage />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Analysis of INC-42" }),
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: /INC-42.*Card payments failing/ }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/42");
    });

    it("offers the admin a start when there is none", async () => {
      api(ADMIN);

      inOrganization(<IncidentAnalysisPage />);

      expect(await screen.findByText("No analysis yet")).toBeDefined();
      expect(screen.getByRole("button", { name: "Start analysis" })).toBeDefined();
    });

    it("offers a member nothing to start", async () => {
      api(MEMBER);

      inOrganization(<IncidentAnalysisPage />);

      expect(await screen.findByText("No analysis yet")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Start analysis" })).toBeNull();
    });

    it("explains that an active incident has no analysis yet, without asking for one", async () => {
      const { requests } = api(ADMIN, {
        detail: resolvedIncident({
          status: "INVESTIGATING",
          resolvedAt: null,
          resolution: null,
        }),
      });

      inOrganization(<IncidentAnalysisPage />);

      expect(
        await screen.findByText(/An analysis begins once INC-42 is resolved/),
      ).toBeDefined();
      expect(screen.getByRole("link", { name: "Go to INC-42" }).getAttribute("href")).toBe(
        "/orgs/acme-ops/incidents/42",
      );
      expect(requests.some((r) => r.path === analysisPath)).toBe(false);
    });

    it("answers an incident that is not there with a not-found page", async () => {
      api(ADMIN, {
        handler: (request) =>
          route(request) === `GET ${base}/incidents/42`
            ? apiError(404, "INCIDENT_NOT_FOUND")
            : undefined,
      });

      inOrganization(<IncidentAnalysisPage />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Incident not found" }),
      ).toBeDefined();
    });

    it("answers a number that cannot be one without asking the API", async () => {
      navigation.params = { orgSlug: "acme-ops", incidentNumber: "abc" };
      const { requests } = api(ADMIN);

      inOrganization(<IncidentAnalysisPage />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Incident not found" }),
      ).toBeDefined();
      expect(requests.some((r) => r.path.includes("/incidents/"))).toBe(false);
    });
  });
});
