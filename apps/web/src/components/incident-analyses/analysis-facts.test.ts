import { describe, expect, it } from "vitest";

import type { IncidentAnalysisFactsResponse } from "@/lib/api/contracts";

import {
  between,
  lasted,
  severityPath,
  sinceDeclared,
  toFirstResponse,
} from "./analysis-facts";

const facts = (
  overrides: Partial<IncidentAnalysisFactsResponse> = {},
): IncidentAnalysisFactsResponse => ({
  declaredAt: "2026-09-18T12:00:00.000Z",
  resolvedAt: "2026-09-18T15:12:00.000Z",
  firstResponseAt: "2026-09-18T12:06:00.000Z",
  responderCount: 3,
  updateCount: 11,
  severity: { declared: "SEV3", highest: "SEV1", final: "SEV2" },
  reassignmentCount: 1,
  ...overrides,
});

describe("analysis facts", () => {
  it("should measure between instants, never backwards", () => {
    expect(between("2026-09-18T12:00:00Z", "2026-09-18T12:06:00Z")).toBe(360_000);
    expect(between("2026-09-18T12:06:00Z", "2026-09-18T12:00:00Z")).toBe(0);
  });

  it("should measure how long it lasted and until the first response", () => {
    expect(lasted(facts())).toBe((3 * 60 + 12) * 60_000);
    expect(toFirstResponse(facts())).toBe(6 * 60_000);
    expect(toFirstResponse(facts({ firstResponseAt: null }))).toBeNull();
  });

  it.each([
    ["2026-09-18T12:00:00.000Z", "T+0"],
    ["2026-09-18T12:00:30.000Z", "T+<1m"],
    ["2026-09-18T12:06:00.000Z", "T+6m"],
    ["2026-09-18T13:04:00.000Z", "T+1h 4m"],
    ["2026-09-20T15:00:00.000Z", "T+2d 3h"],
  ])("should time %s from the declaration as %s", (at, expected) => {
    expect(sinceDeclared("2026-09-18T12:00:00.000Z", at)).toBe(expected);
  });

  describe("severityPath", () => {
    it("should say a severity that never changed once", () => {
      expect(
        severityPath({ declared: "SEV2", highest: "SEV2", final: "SEV2" }),
      ).toEqual({ throughout: "SEV2" });
    });

    it("should name the declared, the peak, and the final level", () => {
      expect(
        severityPath({ declared: "SEV3", highest: "SEV1", final: "SEV2" }),
      ).toEqual({
        steps: [
          { role: "Declared", severity: "SEV3" },
          { role: "Peak", severity: "SEV1" },
          { role: "Final", severity: "SEV2" },
        ],
      });
    });

    it("should not say a peak that is the final level twice", () => {
      expect(
        severityPath({ declared: "SEV3", highest: "SEV2", final: "SEV2" }),
      ).toEqual({
        steps: [
          { role: "Declared", severity: "SEV3" },
          { role: "Final", severity: "SEV2" },
        ],
      });
    });

    it("should not say a peak that is the declared level twice", () => {
      expect(
        severityPath({ declared: "SEV1", highest: "SEV1", final: "SEV3" }),
      ).toEqual({
        steps: [
          { role: "Declared", severity: "SEV1" },
          { role: "Final", severity: "SEV3" },
        ],
      });
    });

    it("should keep a peak between two equal ends", () => {
      expect(
        severityPath({ declared: "SEV2", highest: "SEV1", final: "SEV2" }),
      ).toEqual({
        steps: [
          { role: "Declared", severity: "SEV2" },
          { role: "Peak", severity: "SEV1" },
          { role: "Final", severity: "SEV2" },
        ],
      });
    });
  });
});
