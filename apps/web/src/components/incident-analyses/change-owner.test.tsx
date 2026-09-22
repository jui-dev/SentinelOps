import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IncidentAnalysisResponse } from "@/lib/api/contracts";
import { clearAccessToken } from "@/lib/auth/token-store";
import { apiError, jsonResponse, route } from "@/test/api";
import type { SentRequest } from "@/test/api";
import { expectNoAxeViolations } from "@/test/axe";

import {
  ADMIN,
  READ_ONLY,
  ada,
  analysisPath,
  api,
  asMember,
  daniel,
  draft,
  inOrganization,
  published,
  resolvedIncident,
  sam,
} from "./analysis.fixtures";
import { IncidentAnalysisPage } from "./incident-analysis-page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops", incidentNumber: "42" }),
  usePathname: () => "/orgs/acme-ops/incidents/42/analysis",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/** Daniel and Sam responded; Ada, the caller, did not. */
const incident = resolvedIncident({
  responders: [daniel, sam].map((member) => ({
    membershipId: member.id,
    name: member.user.name,
    status: "COMPLETED" as const,
    startedAt: "2026-09-18T12:05:00.000Z",
    completedAt: "2026-09-18T12:40:00.000Z",
  })),
});

/** The analysis as the server holds it now; tests move it on. */
let server: IncidentAnalysisResponse;

const next = (changes: Partial<IncidentAnalysisResponse>) => {
  server = { ...server, ...changes, version: server.version + 1 };

  return server;
};

const ownedBy = (member: typeof ada) => ({
  owner: { membershipId: member.id, name: member.user.name },
});

/** Signed in as Ada, an Admin, answering a change of owner with `reassign`. */
const asAdmin = (
  reassign: (request: SentRequest) => Response = (request) =>
    jsonResponse(
      200,
      next({
        owner: {
          membershipId: (request.body as { ownerMembershipId: string }).ownerMembershipId,
          name: "Sam Okafor",
        },
      }),
    ),
) =>
  api(ADMIN, {
    detail: incident,
    analysis: server,
    handler: (request) => {
      if (route(request) === `GET ${analysisPath}`) return jsonResponse(200, server);
      if (route(request) === `PUT ${analysisPath}/owner`) return reassign(request);
      return undefined;
    },
  });

const header = async () =>
  (await screen.findByRole("heading", { level: 1, name: "Incident analysis" })).closest(
    "header",
  ) as HTMLElement;

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Change owner" }));

  const dialog = await screen.findByRole("dialog", { name: "Change owner" });

  return {
    dialog,
    select: (await within(dialog).findByLabelText("New owner")) as HTMLSelectElement,
  };
};

const submit = (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) =>
  user.click(within(dialog).getByRole("button", { name: "Change owner" }));

describe("changing an analysis's owner", () => {
  beforeEach(() => {
    clearAccessToken();
    window.sessionStorage.clear();
    server = draft({ version: 3 });
  });

  describe("who is offered it", () => {
    it("offers it to an admin, in the draft's status line", async () => {
      asAdmin();
      inOrganization(<IncidentAnalysisPage />);

      const status = await header();

      expect(await within(status).findByRole("button", { name: "Change owner" })).toBeDefined();
      expect(
        within(document.body).queryByRole("region", { name: "Draft actions" })?.textContent,
      ).not.toContain("Change owner");
    });

    it.each([
      ["the member who owns it", () => asMember(daniel.id)],
      ["another member", () => asMember(sam.id)],
    ])("does not offer it to %s", async (_, as) => {
      const { permissions, handler } = as();

      api(permissions, { analysis: server, handler });
      inOrganization(<IncidentAnalysisPage />);

      await screen.findByText(/Owned by/);
      expect(screen.queryByRole("button", { name: "Change owner" })).toBeNull();
    });

    it.each([
      ["a reader", READ_ONLY, draft()],
      ["an admin, once published", ADMIN, published()],
    ])("does not offer it to %s", async (_, permissions, analysis) => {
      api(permissions, { analysis });
      inOrganization(<IncidentAnalysisPage />);

      await screen.findByRole("heading", { name: /Key moments/ });
      expect(screen.queryByRole("button", { name: "Change owner" })).toBeNull();
    });
  });

  describe("the dialog", () => {
    it("shows the current owner, and offers everyone else, responders first", async () => {
      const user = userEvent.setup();

      asAdmin();
      inOrganization(<IncidentAnalysisPage />);

      const { dialog, select } = await openDialog(user);

      expect(within(dialog).getByText("Daniel Okafor")).toBeDefined();
      expect(dialog.textContent).toContain(
        "The owner is responsible for writing and publishing it. Admins can edit any draft.",
      );

      const [responded, everyone] = within(select).getAllByRole("group");

      expect(responded.getAttribute("label")).toBe("Responded to INC-42");
      expect(within(responded).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Sam Okafor (sam@example.test)",
      ]);
      expect(everyone.getAttribute("label")).toBe("Everyone else");
      expect(within(everyone).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Ada Lovelace (you)",
      ]);
      expect(within(dialog).getByRole("button", { name: "Change owner" })).toHaveProperty(
        "disabled",
        true,
      );
      await expectNoAxeViolations(dialog);
    });

    it("sends the new owner with the version, and the status line follows", async () => {
      const user = userEvent.setup();
      const { requests } = asAdmin();

      inOrganization(<IncidentAnalysisPage />);

      const { dialog, select } = await openDialog(user);

      await user.selectOptions(select, sam.id);
      await submit(user, dialog);

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(requests.find((r) => route(r) === `PUT ${analysisPath}/owner`)?.body).toEqual({
        ownerMembershipId: sam.id,
        version: 3,
      });
      expect((await header()).textContent).toContain("Owned by Sam Okafor");
    });

    it("leaves an admin's unsaved text exactly as it was, and them still editing", async () => {
      const user = userEvent.setup();

      server = draft({ version: 3, ...ownedBy(ada) });
      asAdmin();
      inOrganization(<IncidentAnalysisPage />);

      const cause = (await screen.findByRole("textbox", { name: "Cause" })) as HTMLTextAreaElement;

      await user.type(cause, "  A deploy, half written");

      const { dialog, select } = await openDialog(user);

      await user.selectOptions(select, sam.id);
      await submit(user, dialog);

      expect(
        await within(await header()).findByText(
          "You're editing Sam Okafor's analysis as an admin.",
        ),
      ).toBeDefined();
      expect(cause.value).toBe("  A deploy, half written");
      expect(
        within(screen.getByRole("region", { name: "Draft actions" })).getByRole("status")
          .textContent,
      ).toBe("Unsaved changes: Cause");
      expect(screen.queryByText(/Someone saved changes/)).toBeNull();
    });
  });

  describe("when it is refused", () => {
    it("stays open after a change, and tries again against the refreshed version", async () => {
      const user = userEvent.setup();
      let refused = false;
      const { requests } = asAdmin(() => {
        if (!refused) {
          refused = true;
          next({ impact: "Two hours." });
          return apiError(409, "ANALYSIS_CHANGED");
        }
        return jsonResponse(200, next({ owner: { membershipId: sam.id, name: "Sam Okafor" } }));
      });

      inOrganization(<IncidentAnalysisPage />);

      const { dialog, select } = await openDialog(user);

      await user.selectOptions(select, sam.id);
      await submit(user, dialog);

      expect(
        await within(dialog).findByText(
          "This analysis changed and has been refreshed. Check the owner and try again.",
        ),
      ).toBeDefined();

      await waitFor(async () =>
        expect(((await screen.findByRole("textbox", { name: "Impact" })) as HTMLTextAreaElement).value).toBe("Two hours."),
      );
      await submit(user, dialog);

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(
        requests.filter((r) => route(r) === `PUT ${analysisPath}/owner`).map((r) => r.body),
      ).toEqual([
        { ownerMembershipId: sam.id, version: 3 },
        { ownerMembershipId: sam.id, version: 4 },
      ]);
    });

    it("says when the chosen member has left", async () => {
      const user = userEvent.setup();

      asAdmin(() => apiError(404, "MEMBERSHIP_NOT_FOUND"));
      inOrganization(<IncidentAnalysisPage />);

      const { dialog, select } = await openDialog(user);

      await user.selectOptions(select, sam.id);
      await submit(user, dialog);

      expect(
        await within(dialog).findByText(/no longer a member of this organization/),
      ).toBeDefined();
      expect(select.getAttribute("aria-invalid")).toBe("true");
    });

    it("closes once the analysis turns out to be published", async () => {
      const user = userEvent.setup();

      asAdmin(() => {
        next({
          status: "PUBLISHED",
          publishedBy: { id: ada.user.id, name: "Ada Lovelace" },
          publishedAt: "2026-09-22T14:10:00.000Z",
        });
        return apiError(409, "ANALYSIS_PUBLISHED");
      });
      inOrganization(<IncidentAnalysisPage />);

      const { dialog, select } = await openDialog(user);

      await user.selectOptions(select, sam.id);
      await submit(user, dialog);

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(
        await screen.findByText("This analysis is final. It is kept as published."),
      ).toBeDefined();
      expect(screen.queryByRole("button", { name: "Change owner" })).toBeNull();
    });

    it("stays open to try again after a failure, with nothing typed lost", async () => {
      const user = userEvent.setup();

      server = draft({ version: 3, ...ownedBy(ada) });
      asAdmin(() => apiError(500));
      inOrganization(<IncidentAnalysisPage />);

      const cause = (await screen.findByRole("textbox", { name: "Cause" })) as HTMLTextAreaElement;

      await user.type(cause, "A deploy.");

      const { dialog, select } = await openDialog(user);

      await user.selectOptions(select, sam.id);
      await submit(user, dialog);

      expect(await within(dialog).findByRole("alert")).toBeDefined();
      expect(within(dialog).getByRole("button", { name: "Change owner" })).toHaveProperty(
        "disabled",
        false,
      );
      expect(cause.value).toBe("A deploy.");
    });
  });
});
