import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CriticalityMark } from "@/components/services/criticality-mark";
import type {
  IncidentSeverity,
  IncidentStatus,
  ServiceCriticality,
} from "@/lib/api/contracts";
import { expectNoAxeViolations } from "@/test/axe";

import { SeverityMark, StatusMark } from "./severity";

/**
 * The semantic vocabularies, held apart by form as well as by colour.
 *
 *   severity     a solid glyph and its code — never a badge; the warm signals
 *   lifecycle    a rounded pill; the cool status tokens
 *   criticality  a square-cornered chip; neutrals only
 *
 * So no two dimensions can ever draw the same badge, and Declared can never
 * look like a High service or a SEV3.
 */

const STATUSES: IncidentStatus[] = ["DECLARED", "INVESTIGATING", "RESOLVED"];
const SEVERITIES: IncidentSeverity[] = ["SEV1", "SEV2", "SEV3", "SEV4"];
const CRITICALITIES: ServiceCriticality[] = ["CRITICAL", "HIGH", "NORMAL", "LOW"];

/** Its classes, as written — an SVG's `className` is not a string. */
const classesOf = (element: Element) => element.getAttribute("class") ?? "";

describe("the lifecycle vocabulary", () => {
  it.each([
    ["DECLARED", "Declared", "declared"],
    ["INVESTIGATING", "Investigating", "investigating"],
    ["RESOLVED", "Resolved", "resolved"],
  ] as const)("draws %s as a pill in its own colours", (status, word, token) => {
    render(<StatusMark status={status} />);

    const pill = screen.getByText(word);

    expect(classesOf(pill)).toMatch(/rounded-full/);
    expect(classesOf(pill)).toContain(`bg-status-${token}-subtle`);
    expect(classesOf(pill)).toContain(`text-status-${token}-text`);
    expect(classesOf(pill)).toContain(`border-status-${token}-line`);
    // Its icon is part of it, and says nothing a screen reader needs.
    expect(pill.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives every status a colour of its own", () => {
    const { container } = render(
      <>
        {STATUSES.map((status) => (
          <StatusMark key={status} status={status} />
        ))}
      </>,
    );
    const tints = [...container.querySelectorAll("span.rounded-full")].map(
      (pill) => classesOf(pill).match(/bg-status-[a-z]+-subtle/)?.[0],
    );

    expect(new Set(tints).size).toBe(STATUSES.length);
  });

  it("never borrows severity's, feedback's, or the accent's colours", () => {
    const { container } = render(
      <>
        {STATUSES.map((status) => (
          <StatusMark key={status} status={status} />
        ))}
      </>,
    );

    expect(container.innerHTML).not.toMatch(
      /signal-|warning-|success-|danger-|accent/,
    );
  });

  it("names a status inside a sentence without a pill, in the same colour", () => {
    render(
      <p>
        The incident is now <StatusMark status="INVESTIGATING" variant="inline" />
      </p>,
    );

    const word = screen.getByText("Investigating");

    expect(classesOf(word)).not.toMatch(/rounded-full|bg-/);
    expect(classesOf(word.querySelector("svg")!)).toContain(
      "text-status-investigating-text",
    );
  });

  it("draws a retired status as a neutral word, with no lifecycle colour", () => {
    render(<StatusMark status="MONITORING" />);

    const pill = screen.getByText("Monitoring");

    expect(classesOf(pill)).not.toMatch(/status-/);
    expect(pill.querySelector("svg")).toBeNull();
  });
});

describe("the criticality vocabulary", () => {
  const chips = () =>
    render(
      <>
        {CRITICALITIES.map((level) => (
          <CriticalityMark key={level} criticality={level} />
        ))}
      </>,
    ).container.querySelectorAll(":scope > span");

  it("draws every level as the same chip, gauge and word", () => {
    const drawn = [...chips()];

    expect(drawn).toHaveLength(4);
    for (const chip of drawn) {
      expect(classesOf(chip)).toMatch(/rounded-sm/);
      expect(classesOf(chip)).toMatch(/(^|\s)border(\s|$)/);
      expect(chip.querySelectorAll("rect")).toHaveLength(4);
    }
    expect(drawn.map((chip) => chip.textContent)).toEqual([
      "Critical",
      "High",
      "Normal",
      "Low",
    ]);
  });

  it("rises in strength with the level, to a solid Critical", () => {
    const [critical, high, normal, low] = [...chips()].map(classesOf);

    expect(critical).toContain("bg-fg");
    expect(critical).toContain("text-canvas");
    expect(high).toMatch(/(^|\s)text-fg(\s|$)/);
    expect(normal).toContain("text-fg-muted");
    expect(low).toContain("text-fg-subtle");
  });

  it("is never a pill, and never takes a hue", () => {
    const drawn = [...chips()];

    for (const chip of drawn) {
      expect(classesOf(chip)).not.toMatch(/rounded-full/);
      expect(chip.outerHTML).not.toMatch(/signal-|status-|warning-|accent/);
    }
  });
});

describe("the severity vocabulary", () => {
  it("stays a solid glyph and its code, never a badge", () => {
    const { container } = render(
      <>
        {SEVERITIES.map((severity) => (
          <SeverityMark key={severity} severity={severity} />
        ))}
      </>,
    );

    expect(container.innerHTML).not.toMatch(/rounded-|bg-|border-|status-/);
    expect(container.querySelectorAll("svg")).toHaveLength(4);
  });
});

it("has no accessibility violations across the three vocabularies", async () => {
  const { container } = render(
    <ul>
      {STATUSES.map((status) => (
        <li key={status}>
          <StatusMark status={status} />
        </li>
      ))}
      {CRITICALITIES.map((level) => (
        <li key={level}>
          <CriticalityMark criticality={level} />
        </li>
      ))}
      {SEVERITIES.map((severity) => (
        <li key={severity}>
          <SeverityMark severity={severity} />
        </li>
      ))}
    </ul>,
  );

  await expectNoAxeViolations(container);
});
