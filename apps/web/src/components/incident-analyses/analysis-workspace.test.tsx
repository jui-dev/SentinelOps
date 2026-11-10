import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  IncidentAnalysisResponse,
  IncidentKeyMomentResponse,
} from "@/lib/api/contracts";
import { clearAccessToken } from "@/lib/auth/token-store";

import {
  ADMIN,
  READ_ONLY,
  ada,
  api,
  asMember,
  daniel,
  draft,
  inOrganization,
  published,
  sam,
} from "./analysis.fixtures";
import { IncidentAnalysisPage } from "./incident-analysis-page";

const navigation = vi.hoisted(() => ({
  params: { orgSlug: "acme-ops", incidentNumber: "42" },
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => "/orgs/acme-ops/incidents/42/analysis",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const at = (minutes: number) =>
  new Date(Date.UTC(2026, 8, 18, 12, minutes)).toISOString();

const moment = (
  n: number,
  kind: IncidentKeyMomentResponse["kind"],
  minutes: number,
  overrides: Partial<IncidentKeyMomentResponse> = {},
): IncidentKeyMomentResponse => ({
  kind,
  activityId: `0199a1b2-c3d4-7000-8000-${String(n).padStart(12, "0")}`,
  at: at(minutes),
  actor: { id: ada.user.id, name: "Ada Lovelace" },
  fromValue: null,
  toValue: null,
  ...overrides,
});

const daniels = { actor: { id: daniel.user.id, name: "Daniel Okafor" } };

/** An hour-long incident whose severity rose and fell, and that changed teams. */
const eventful = (
  overrides: Partial<IncidentAnalysisResponse> = {},
): IncidentAnalysisResponse =>
  draft({
    facts: {
      declaredAt: at(0),
      resolvedAt: at(60),
      firstResponseAt: at(5),
      responderCount: 3,
      updateCount: 1,
      severity: { declared: "SEV3", highest: "SEV1", final: "SEV2" },
      reassignmentCount: 0,
    },
    keyMoments: [
      moment(1, "DECLARED", 0, { toValue: "SEV3" }),
      moment(2, "FIRST_RESPONSE", 5, daniels),
      moment(3, "SEVERITY_CHANGED", 20, { fromValue: "SEV3", toValue: "SEV1" }),
      moment(4, "TEAM_CHANGED", 30, { fromValue: "Payments", toValue: "Platform" }),
      moment(5, "SEVERITY_CHANGED", 40, { fromValue: "SEV1", toValue: "SEV2" }),
      moment(6, "LAST_RESPONSE_COMPLETED", 55, daniels),
      moment(7, "RESOLVED", 60),
    ],
    ...overrides,
  });

/** The facts strip, found by its (visually hidden) heading. */
const factsStrip = async () =>
  (await screen.findByRole("heading", { name: "What the record says" })).closest(
    "section",
  ) as HTMLElement;

/** A facts reading: the definition its label names. */
const reading = (strip: HTMLElement, label: string) =>
  within(strip).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;

describe("the incident analysis workspace", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  describe("its facts", () => {
    it("reads how long it lasted and until the first response first", async () => {
      api(READ_ONLY, { analysis: eventful() });

      inOrganization(<IncidentAnalysisPage />);

      const strip = await factsStrip();

      expect(reading(strip, "Lasted").textContent).toMatch(/^1h/);
      expect(reading(strip, "First response").textContent).toBe("5mAfter declaration");
    });

    it("walks severity from its declared level to its peak and final one", async () => {
      api(READ_ONLY, { analysis: eventful() });

      inOrganization(<IncidentAnalysisPage />);

      const steps = within(reading(await factsStrip(), "Severity")).getAllByRole(
        "listitem",
      );

      expect(steps.map((step) => step.textContent)).toEqual([
        "SEV3ModerateDeclared",
        "→SEV1CriticalPeak",
        "→SEV2MajorFinal",
      ]);
    });

    it("says a severity that never changed once", async () => {
      api(READ_ONLY, { analysis: draft() });

      inOrganization(<IncidentAnalysisPage />);

      expect(reading(await factsStrip(), "Severity").textContent).toBe(
        "SEV1Criticalthroughout",
      );
    });

    it("keeps the counts secondary, each in words", async () => {
      api(READ_ONLY, { analysis: eventful() });

      inOrganization(<IncidentAnalysisPage />);

      const counts = within(await factsStrip()).getByRole("group", {
        name: "Response counts",
      });

      expect(
        within(counts)
          .getAllByRole("term")
          .map((term) => `${term.previousElementSibling?.textContent} ${term.textContent}`),
      ).toEqual(["3 responders", "1 update", "0 reassignments"]);
    });

    it("says when nobody's first response was recorded", async () => {
      const analysis = eventful();

      api(READ_ONLY, {
        analysis: {
          ...analysis,
          facts: { ...analysis.facts, firstResponseAt: null, responderCount: 0 },
          keyMoments: analysis.keyMoments.filter(
            ({ kind }) => kind !== "FIRST_RESPONSE" && kind !== "LAST_RESPONSE_COMPLETED",
          ),
        },
      });

      inOrganization(<IncidentAnalysisPage />);

      expect(reading(await factsStrip(), "First response").textContent).toBe(
        "—None recorded",
      );
    });
  });

  describe("its key moments", () => {
    /** The moments' cards: the words, beneath the track. */
    const rows = async () =>
      within(await screen.findByRole("list", { name: "Moments" })).getAllByRole("listitem");

    it("tells each moment at its time from the declaration, in few words", async () => {
      api(READ_ONLY, { analysis: eventful() });

      inOrganization(<IncidentAnalysisPage />);

      // The time from the declaration, then what happened.
      const lines = (await rows()).map((row) => {
        const [what, , when] = row.lastElementChild!.children;

        return `${when.textContent?.split(" · ")[0]} ${what.textContent}`;
      });

      expect(lines).toEqual([
        "T+0 Declared at SEV3Moderate",
        "T+5m First response",
        "T+20m Severity SEV3Moderate →  to SEV1Critical",
        "T+30m Reassigned Payments →  to Platform",
        "T+40m Severity SEV1Critical →  to SEV2Major",
        "T+55m Last response completed",
        "T+1h Resolved",
      ]);
    });

    it("names who made each moment, and counts them", async () => {
      api(READ_ONLY, { analysis: eventful() });

      inOrganization(<IncidentAnalysisPage />);

      const [, firstResponse] = await rows();

      expect(firstResponse.textContent).toContain("Daniel Okafor");
      // The time alone is shown; its day and year are on hover, and read out.
      const time = firstResponse.querySelector("time")!;

      expect(time.getAttribute("dateTime")).toBe("2026-09-18T12:05:00.000Z");
      expect(time.querySelector('[aria-hidden="true"]')?.textContent).not.toMatch(/2026/);
      expect(time.getAttribute("title")).toMatch(/2026/);
      expect(time.querySelector(".sr-only")?.textContent).toBe(time.getAttribute("title"));
      expect(await rows()).toHaveLength(7);
      // How long it all took, beside its name; how the time went, in words.
      expect(screen.getByRole("heading", { name: /Key moments/ }).textContent).toBe(
        "Key moments · 1h in all",
      );
      expect(
        within(screen.getByRole("list", { name: "How the time went" }))
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["5mto first response", "50mworked", "5mto resolve"]);
    });

    it("leads on to the incident's whole timeline", async () => {
      api(READ_ONLY, { analysis: eventful() });

      inOrganization(<IncidentAnalysisPage />);

      expect(
        (await screen.findByRole("link", { name: "Full timeline" })).getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/42#timeline");
    });
  });

  describe("its document", () => {
    const sections = async () =>
      within(await screen.findByRole("article", { name: "Analysis" }))
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.parentElement?.textContent);

    it("reads a draft in order, saying what is still to be written", async () => {
      api(READ_ONLY, { analysis: draft() });

      inOrganization(<IncidentAnalysisPage />);

      expect(await sections()).toEqual([
        "SummaryCard payments failed after a deploy.",
        "ImpactCheckout unavailable for an hour.",
        "CauseNot written yet.",
        "LessonsNot written yet.",
      ]);
      expect(screen.queryByText(/This analysis is final/)).toBeNull();
    });

    it("reads a published one as final, saying what was never recorded", async () => {
      api(READ_ONLY, { analysis: published() });

      inOrganization(<IncidentAnalysisPage />);

      expect(await sections()).toEqual([
        "SummaryCard payments failed after a deploy.",
        "ImpactCheckout unavailable for an hour.",
        "CauseNot recorded.",
        "LessonsNot recorded.",
      ]);
      expect(
        screen.getByText("This analysis is final. It is kept as published."),
      ).toBeDefined();
    });

    it("keeps the page's headings in order", async () => {
      api(READ_ONLY, { analysis: eventful() });

      inOrganization(<IncidentAnalysisPage />);

      await screen.findByRole("article", { name: "Analysis" });

      expect(
        screen.getAllByRole("heading").map((h) => `${h.tagName} ${h.textContent}`),
      ).toEqual([
        "H1 Analysis of INC-42",
        "H2 What the record says",
        "H3 Key moments · 1h in all",
        "H2 Summary",
        "H2 Impact",
        "H2 Cause",
        "H2 Lessons",
      ]);
    });
  });

  describe("its status", () => {
    const header = async () =>
      (await screen.findByRole("heading", { level: 1, name: "Analysis of INC-42" }))
        .closest("header") as HTMLElement;

    it("tells the owner their draft is theirs", async () => {
      const { permissions, handler } = asMember(daniel.id);

      api(permissions, { analysis: draft(), handler });

      inOrganization(<IncidentAnalysisPage />);

      const status = await header();

      expect(await within(status).findByText(/Owned by/)).toBeDefined();
      expect(status.textContent).toContain("Owned by Daniel Okafor (you)");
      expect(status.textContent).not.toContain("is writing this analysis");
    });

    it("tells an admin they are editing someone else's draft", async () => {
      api(ADMIN, { analysis: draft() });

      inOrganization(<IncidentAnalysisPage />);

      expect(
        await within(await header()).findByText(
          "You're editing Daniel Okafor's analysis as an admin.",
        ),
      ).toBeDefined();
    });

    it("tells anyone else who is writing it, and that it may change", async () => {
      const { permissions, handler } = asMember(sam.id);

      api(permissions, { analysis: draft(), handler });

      inOrganization(<IncidentAnalysisPage />);

      const status = await header();

      expect(
        await within(status).findByText(
          "Daniel Okafor is writing this analysis. It may change until it is published.",
        ),
      ).toBeDefined();
      expect(status.textContent).not.toContain("(you)");
    });

    it("keeps when a draft was started and last changed beside it, and no version", async () => {
      api(READ_ONLY, { analysis: draft() });

      inOrganization(<IncidentAnalysisPage />);

      // In the status line, where the side column held them.
      await screen.findByText(/^Started/);

      const header = (
        await screen.findByRole("heading", { level: 1, name: "Analysis of INC-42" })
      ).closest("header") as HTMLElement;

      expect(header.textContent).toMatch(/Started .+ by Ada Lovelace/);
      expect(header.textContent).toMatch(/Last changed /);
      expect(document.body.textContent).not.toMatch(/version/i);
    });

    it("names the service and team the incident concerned, draft and published alike", async () => {
      for (const analysis of [draft(), published()]) {
        api(READ_ONLY, { analysis });

        const { unmount } = inOrganization(<IncidentAnalysisPage />);
        const status = await header();

        expect(
          (await within(status).findByRole("link", { name: "Payment API" })).getAttribute("href"),
        ).toBe("/orgs/acme-ops/services/payment-api");
        expect(within(status).getByRole("link", { name: "Payments" }).getAttribute("href")).toBe(
          "/orgs/acme-ops/teams/payments",
        );
        unmount();
      }
    });

    it("leads a published analysis with its publication, then its owner and start", async () => {
      api(READ_ONLY, { analysis: published() });

      inOrganization(<IncidentAnalysisPage />);

      const status = await header();
      const attribution = (await within(status).findByText(/^Owner /)).closest(
        "p",
      ) as HTMLElement;
      const publication = attribution.previousElementSibling as HTMLElement;

      expect(publication.textContent).toMatch(/^Published·, .+·, by Ada Lovelace$/);
      expect(attribution.textContent).toMatch(
        /^Owner Daniel Okafor·, Started .+ by Ada Lovelace$/,
      );
      // The header says all of it: no draft record beside the document.
      expect(screen.queryByText("Last changed")).toBeNull();
      expect(document.body.textContent).not.toMatch(/version/i);
    });
  });
});
