import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN,
  ada,
  api,
  asMember,
  base,
  daniel,
  inOrganization,
  resolvedIncident,
  sam,
  team,
} from "@/components/incident-analyses/analysis.fixtures";
import type { IncidentDetailResponse } from "@/lib/api/contracts";
import { clearAccessToken } from "@/lib/auth/token-store";
import { jsonResponse, route } from "@/test/api";
import type { SentRequest } from "@/test/api";
import { expectNoAxeViolations } from "@/test/axe";

import { IncidentDetail } from "./incident-detail";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops", incidentNumber: "42" }),
  usePathname: () => "/orgs/acme-ops/incidents/42",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const accessPath = `${base}/incidents/42/response-access`;
const platform = { id: "0199a1b2-c3d4-7000-8000-0000000000c2", name: "Platform", slug: "platform" };

const active = (overrides: Partial<IncidentDetailResponse> = {}): IncidentDetailResponse =>
  resolvedIncident({
    status: "DECLARED",
    resolvedAt: null,
    resolution: null,
    responders: [],
    responseAccess: "PENDING",
    ...overrides,
  });

const investigating = (who: typeof daniel) => ({
  membershipId: who.id,
  name: who.user.name,
  status: "INVESTIGATING" as const,
  startedAt: "2026-09-18T12:05:00.000Z",
  completedAt: null,
});

/** As the Admin: Daniel is on the responsible team, Sam on another. */
const asAdmin = (detail: IncidentDetailResponse, answer?: (request: SentRequest) => IncidentDetailResponse) =>
  api(ADMIN, {
    detail,
    handler: (request) => {
      if (route(request) === `GET ${base}/memberships`) {
        return jsonResponse(200, [
          ada,
          { ...daniel, teams: [team] },
          { ...sam, teams: [platform] },
        ]);
      }
      if (route(request) === `PUT ${accessPath}` && answer) {
        return jsonResponse(200, answer(request));
      }

      return undefined;
    },
  });

const panel = () => screen.findByRole("region", { name: /Responders$/ });

const sent = (requests: SentRequest[]) =>
  requests.filter((request) => route(request) === `PUT ${accessPath}`).map(({ body }) => body);

describe("who responds to an incident", () => {
  beforeEach(() => {
    clearAccessToken();
    window.sessionStorage.clear();
  });

  describe("right after declaring", () => {
    it("asks the Admin, naming the team and saying nobody can start", async () => {
      asAdmin(active());
      inOrganization(<IncidentDetail />);

      const responders = await panel();

      expect(within(responders).getByText("Who should respond to this incident?")).toBeDefined();
      expect(within(responders).getByText("Needs your decision")).toBeDefined();
      expect(
        within(responders).getByText(
          "Payments can see this incident, but nobody can start until you choose.",
        ),
      ).toBeDefined();
      expect(screen.getByText("Waiting for your decision.")).toBeDefined();
      await expectNoAxeViolations(document.body);
    });

    it("opens it to the team in one step", async () => {
      const user = userEvent.setup();
      const { requests } = asAdmin(active(), () => active({ responseAccess: "OPEN" }));

      inOrganization(<IncidentDetail />);

      await user.click(within(await panel()).getByRole("button", { name: "Open to team" }));

      expect(await screen.findByRole("heading", { name: "Responders" })).toBeDefined();
      expect(await screen.findByText("Open to Payments")).toBeDefined();
      expect(sent(requests)).toEqual([{ mode: "OPEN" }]);
    });
  });

  describe("assigning people", () => {
    const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(within(await panel()).getByRole("button", { name: "Assign people" }));

      return screen.findByRole("dialog", { name: "Assign people to INC-42" });
    };

    it("sets the responsible team apart, and leaves out Admins", async () => {
      const user = userEvent.setup();

      asAdmin(active());
      inOrganization(<IncidentDetail />);

      const dialog = await openDialog(user);
      const teamGroup = await within(dialog).findByRole("group", {
        name: "Payments, the responsible team",
      });

      expect(within(teamGroup).getByText("Responsible team")).toBeDefined();
      expect(within(teamGroup).getByRole("checkbox", { name: /Daniel Okafor/ })).toBeDefined();

      const others = within(dialog).getByRole("group", {
        name: "Everyone else in the organization",
      });

      expect(within(others).getByRole("checkbox", { name: /Sam Okafor/ })).toBeDefined();
      expect(within(dialog).queryByRole("checkbox", { name: /Ada Lovelace/ })).toBeNull();
      await expectNoAxeViolations(dialog);
    });

    it("needs someone chosen, then assigns them and notes who is outside the team", async () => {
      const user = userEvent.setup();
      const { requests } = asAdmin(active(), () =>
        active({
          responseAccess: "ASSIGNED",
          assignees: [{ membershipId: sam.id, name: sam.user.name }],
        }),
      );

      inOrganization(<IncidentDetail />);

      const dialog = await openDialog(user);

      await within(dialog).findByRole("checkbox", { name: /Sam Okafor/ });

      const submit = within(dialog).getByRole("button", { name: "Assign people" });

      expect((submit as HTMLButtonElement).disabled).toBe(true);

      await user.click(within(dialog).getByRole("checkbox", { name: /Sam Okafor/ }));

      expect(dialog.textContent).toContain("Sam Okafor is outside Payments");

      await user.click(within(dialog).getByRole("button", { name: "Assign 1 person" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(sent(requests)).toEqual([{ mode: "ASSIGNED", membershipIds: [sam.id] }]);
      expect(await screen.findByText("Assigned to 1 person")).toBeDefined();
      expect(await screen.findByText("Assigned, not started")).toBeDefined();
    });

    it("keeps whoever is investigating ticked and locked", async () => {
      const user = userEvent.setup();

      asAdmin(active({ responseAccess: "OPEN", status: "INVESTIGATING", responders: [investigating(daniel)] }));
      inOrganization(<IncidentDetail />);

      const dialog = await openDialog(user);
      const daniels = (await within(dialog).findByRole("checkbox", {
        name: /Daniel Okafor/,
      })) as HTMLInputElement;

      expect(daniels.checked).toBe(true);
      expect(daniels.disabled).toBe(true);
      expect(within(dialog).getByText("Already investigating")).toBeDefined();
    });

    it("finds people by name or team", async () => {
      const user = userEvent.setup();

      asAdmin(active());
      inOrganization(<IncidentDetail />);

      const dialog = await openDialog(user);

      await within(dialog).findByRole("checkbox", { name: /Sam Okafor/ });
      await user.type(within(dialog).getByRole("textbox", { name: "Find a person" }), "platform");

      expect(within(dialog).getByRole("checkbox", { name: /Sam Okafor/ })).toBeDefined();
      expect(within(dialog).queryByRole("checkbox", { name: /Daniel Okafor/ })).toBeNull();
    });
  });

  describe("once assigned", () => {
    const assigned = active({
      responseAccess: "ASSIGNED",
      status: "INVESTIGATING",
      assignees: [
        { membershipId: daniel.id, name: daniel.user.name },
        { membershipId: sam.id, name: sam.user.name },
      ],
      responders: [investigating(daniel)],
    });

    it("lists each person, can remove only who hasn't started, and can open to the team", async () => {
      const user = userEvent.setup();
      const { requests } = asAdmin(assigned, () =>
        active({ ...assigned, assignees: [assigned.assignees[0]] }),
      );

      inOrganization(<IncidentDetail />);

      const responders = await panel();

      expect(within(responders).getByText("Assigned to 2 people")).toBeDefined();
      expect(within(responders).getByRole("button", { name: "Open to team instead" })).toBeDefined();
      expect(within(responders).queryByRole("button", { name: "Remove Daniel Okafor" })).toBeNull();

      await user.click(within(responders).getByRole("button", { name: "Remove Sam Okafor" }));

      await waitFor(() =>
        expect(sent(requests)).toEqual([{ mode: "ASSIGNED", membershipIds: [daniel.id] }]),
      );
    });

    it("says who hasn't started, in where the response stands", async () => {
      asAdmin(assigned);
      inOrganization(<IncidentDetail />);

      expect(
        await screen.findByText(/Daniel Okafor is still investigating\. Sam Okafor hasn't started\./),
      ).toBeDefined();
    });
  });

  describe("for a member", () => {
    const as = (membershipId: string, detail: IncidentDetailResponse) => {
      const { permissions, handler } = asMember(membershipId);

      return api(permissions, {
        detail,
        handler: (request) =>
          route(request) === `GET ${base}/teams/${team.id}/members`
            ? jsonResponse(200, [
                { membershipId: daniel.id, user: daniel.user, createdAt: daniel.createdAt },
              ])
            : handler(request),
      });
    };

    it("offers no start while the Admin hasn't chosen", async () => {
      as(daniel.id, active());
      inOrganization(<IncidentDetail />);

      expect(await screen.findByText("Waiting for the Admin.")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Start investigating" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Assign people" })).toBeNull();
    });

    it("offers it to the team once open", async () => {
      as(daniel.id, active({ responseAccess: "OPEN" }));
      inOrganization(<IncidentDetail />);

      expect(await screen.findByRole("button", { name: "Start investigating" })).toBeDefined();
    });

    it("offers it only to the people assigned, whatever their team", async () => {
      const assigned = active({
        responseAccess: "ASSIGNED",
        assignees: [{ membershipId: sam.id, name: sam.user.name }],
      });

      as(sam.id, assigned);
      const first = inOrganization(<IncidentDetail />);

      expect(await screen.findByRole("button", { name: "Start investigating" })).toBeDefined();
      first.unmount();

      as(daniel.id, assigned);
      inOrganization(<IncidentDetail />);

      expect(await screen.findByText("Waiting for the people assigned to start.")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Start investigating" })).toBeNull();
    });
  });
});
