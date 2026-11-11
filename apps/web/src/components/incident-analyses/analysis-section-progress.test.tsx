import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYSIS_SECTIONS } from "@/lib/api/contracts";
import type {
  AnalysisSection,
  EditIncidentAnalysisRequest,
  IncidentAnalysisResponse,
} from "@/lib/api/contracts";
import { clearAccessToken } from "@/lib/auth/token-store";
import { jsonResponse, route } from "@/test/api";
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

/** The analysis as the server holds it now. */
let server: IncidentAnalysisResponse;

/** Answers a PATCH as the API does: text applied, marks applied, a new version. */
const applied = (request: SentRequest) => {
  const body = request.body as EditIncidentAnalysisRequest;
  const text = Object.fromEntries(
    ANALYSIS_SECTIONS.filter((section) => body[section] !== undefined).map((section) => [
      section,
      body[section],
    ]),
  );

  server = {
    ...server,
    ...text,
    doneSections: ANALYSIS_SECTIONS.filter(
      (section) =>
        body.markDone?.includes(section) ||
        (server.doneSections.includes(section) && !body.reopen?.includes(section)),
    ),
    version: server.version + 1,
    updatedAt: `2026-09-22T1${server.version}:00:00.000Z`,
  };

  return jsonResponse(200, server);
};

const open = async () => {
  const { permissions, handler } = asMember(daniel.id);
  const mock = api(permissions, {
    analysis: server,
    handler: (request) => {
      if (route(request) === `GET ${analysisPath}`) return jsonResponse(200, server);
      if (request.path === analysisPath && request.method === "PATCH") return applied(request);
      if (request.path === `${analysisPath}/publish` && request.method === "POST") {
        server = {
          ...server,
          status: "PUBLISHED",
          version: server.version + 1,
          publishedBy: { id: daniel.user.id, name: "Daniel Okafor" },
          publishedAt: "2026-09-22T14:10:00.000Z",
        };

        return jsonResponse(200, server);
      }

      return handler(request);
    },
  });

  inOrganization(<IncidentAnalysisPage />);
  await screen.findByRole("form", { name: "Analysis" });

  return mock;
};

const writes = (mock: Awaited<ReturnType<typeof open>>) =>
  mock.requests
    .filter((request) => request.path === analysisPath && request.method === "PATCH")
    .map((request) => request.body);

const card = (name: string) => screen.getByRole("region", { name });

const progress = () => screen.getByRole("region", { name: "Progress" });

const standing = (section: AnalysisSection) =>
  within(screen.getByRole("navigation", { name: "Sections" }))
    .getByRole("link", { name: new RegExp(`^${section}`, "i") })
    .textContent?.split(", ")[1];

describe("the sections of an analysis", () => {
  beforeEach(() => {
    clearAccessToken();
    window.sessionStorage.clear();
    server = draft({ summary: null, impact: null, cause: null, lessons: null });
  });

  it("offers Mark as done only once a section holds text", async () => {
    const user = userEvent.setup();

    await open();

    const cause = card("Cause");

    expect(within(cause).getByText("Not started")).toBeDefined();
    expect(within(cause).queryByRole("button", { name: /Mark as done/ })).toBeNull();

    await user.type(within(cause).getByRole("textbox"), "A deploy");

    expect(within(cause).getByText("In progress")).toBeDefined();
    expect(within(cause).getByText("Not counted until you mark it done.")).toBeDefined();
    expect(
      within(cause).getByRole("button", { name: "Mark as done: Cause" }),
    ).toBeDefined();
  });

  it("does not count typing as progress", async () => {
    const user = userEvent.setup();

    await open();
    await user.type(within(card("Summary")).getByRole("textbox"), "Payments failed.");

    expect(within(progress()).getByText("0 of 4 sections done")).toBeDefined();
    expect(standing("summary")).toBe("in progress");
    expect(progress().textContent).toContain("Mark the summary as done");
  });

  it("saves and finishes one section, leaving other unsaved text alone", async () => {
    const user = userEvent.setup();
    const mock = await open();

    await user.type(within(card("Summary")).getByRole("textbox"), "Payments failed.");
    await user.type(within(card("Lessons")).getByRole("textbox"), "Half a thought");
    await user.click(
      within(card("Summary")).getByRole("button", { name: "Mark as done: Summary" }),
    );

    await waitFor(() => expect(within(card("Summary")).getByText("Done")).toBeDefined());

    expect(writes(mock)).toEqual([
      { version: 3, summary: "Payments failed.", markDone: ["summary"] },
    ]);
    // Finished text reads as text, with the way back beside it.
    expect(within(card("Summary")).queryByRole("textbox")).toBeNull();
    expect(within(card("Summary")).getByText("Payments failed.")).toBeDefined();
    expect(document.activeElement).toBe(
      within(card("Summary")).getByRole("button", { name: "Edit Summary" }),
    );
    expect(
      (within(card("Lessons")).getByRole("textbox") as HTMLTextAreaElement).value,
    ).toBe("Half a thought");
    expect(within(progress()).getByText("1 of 4 sections done")).toBeDefined();
    expect(progress().textContent).toContain("Lessons is still in progress.");
    expect(
      within(screen.getByRole("region", { name: "Draft actions" })).getByRole("status")
        .textContent,
    ).toContain("Unsaved changes: Lessons");
  });

  it("takes a done section back to work on with Edit", async () => {
    const user = userEvent.setup();

    server = draft({ doneSections: ["summary"] });

    const mock = await open();

    await user.click(within(card("Summary")).getByRole("button", { name: "Edit Summary" }));

    await waitFor(() => expect(within(card("Summary")).getByText("In progress")).toBeDefined());

    expect(writes(mock)).toEqual([{ version: 3, reopen: ["summary"] }]);

    const summary = within(card("Summary")).getByRole("textbox") as HTMLTextAreaElement;

    expect(summary.value).toBe("Card payments failed after a deploy.");
    expect(document.activeElement).toBe(summary);
    expect(within(progress()).getByText("0 of 4 sections done")).toBeDefined();
  });

  it("names each standing in the progress card", async () => {
    server = draft({ doneSections: ["summary"] });

    await open();

    expect(standing("summary")).toBe("done");
    expect(standing("impact")).toBe("in progress");
    expect(standing("cause")).toBe("not started");
    expect(within(progress()).getByRole("img", { name: "1 of 4 sections done" })).toBeDefined();
    expect(progress().textContent).toContain(
      "The summary is done, so this can be published. Impact is still in progress.",
    );
  });

  it("keeps Publish shut until the summary is marked done, and says why", async () => {
    await open();

    const bar = screen.getByRole("region", { name: "Draft actions" });
    const publish = within(bar).getByRole("button", { name: "Publish…" }) as HTMLButtonElement;

    expect(publish.disabled).toBe(true);
    expect(bar.textContent).toContain("Mark the summary as done to publish.");
  });

  it("warns before publishing a section in progress, then allows it", async () => {
    const user = userEvent.setup();

    server = draft({ doneSections: ["summary"] });

    const mock = await open();

    await user.click(screen.getByRole("button", { name: "Publish…" }));

    const dialog = await screen.findByRole("dialog", { name: "Publish this analysis?" });

    expect(dialog.textContent).toContain(
      "Impact is still in progress. It will be published exactly as it is written now.",
    );
    expect(
      within(within(dialog).getByRole("list", { name: "What will be published" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "SummaryDone",
      "ImpactIn progress",
      "CauseBlank, left out",
      "LessonsBlank, left out",
    ]);
    expect(within(dialog).getByRole("button", { name: "Go back and finish" })).toBeDefined();

    await expectNoAxeViolations(dialog);
    await user.click(within(dialog).getByRole("button", { name: "Publish anyway" }));

    expect(await screen.findByText("Analysis published.")).toBeDefined();
    expect(
      mock.requests.filter((request) => request.path === `${analysisPath}/publish`),
    ).toHaveLength(1);
  });

  it("goes back to the page from the warning, publishing nothing", async () => {
    const user = userEvent.setup();

    server = draft({ doneSections: ["summary"] });

    const mock = await open();

    await user.click(screen.getByRole("button", { name: "Publish…" }));
    await user.click(await screen.findByRole("button", { name: "Go back and finish" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      mock.requests.filter((request) => request.path === `${analysisPath}/publish`),
    ).toHaveLength(0);
  });

  it("does not warn when nothing is left in progress", async () => {
    const user = userEvent.setup();

    server = draft({ impact: null, doneSections: ["summary"] });

    await open();
    await user.click(screen.getByRole("button", { name: "Publish…" }));

    const dialog = await screen.findByRole("dialog", { name: "Publish this analysis?" });

    expect(dialog.textContent).not.toContain("still in progress");
    expect(within(dialog).getByRole("button", { name: "Publish analysis" })).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("has no accessibility violations with every standing on the page", async () => {
    server = draft({ doneSections: ["summary"] });

    await open();
    await expectNoAxeViolations(document.body);
  });
});
