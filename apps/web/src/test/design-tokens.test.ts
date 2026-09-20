import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards the design tokens in globals.css.
 *
 * jsdom renders no CSS, so contrast cannot be checked on rendered pages.
 * Instead the token pairs the components actually combine are checked here,
 * in both halves of every `light-dark()`: a token edit that breaks WCAG AA in
 * either theme fails the build rather than a user.
 */

const SRC = join(__dirname, "..");
const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");

type Theme = "light" | "dark";

const tokens = new Map<string, Record<Theme, string>>();

for (const [, name, light, dark] of css.matchAll(
  /--color-([a-z0-9-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\);/g,
)) {
  tokens.set(name, { light, dark });
}

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;

    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (high + 0.05) / (low + 0.05);
};

const colour = (name: string, theme: Theme): string => {
  const token = tokens.get(name);

  if (!token) throw new Error(`No colour token --color-${name}`);

  return token[theme];
};

/** Text (4.5:1, WCAG 1.4.3) and non-text UI (3:1, WCAG 1.4.11) pairs. */
const TEXT = 4.5;
const UI = 3;

const pairs: Array<[foreground: string, background: string, minimum: number]> = [];
const each = (fgs: string[], bgs: string[], minimum: number) =>
  fgs.forEach((fg) => bgs.forEach((bg) => pairs.push([fg, bg, minimum])));

// Body, secondary, and metadata text on every surface text sits on: the
// workspace and what sits on it, and every stop of the rail's gradient.
const RAIL = ["rail-top", "rail-mid", "rail-bottom", "rail-hover"];
const WORKSPACE = [
  "canvas",
  "surface",
  "thead",
  "field",
  "sunken",
  "hover",
];

each(["fg", "fg-muted", "fg-subtle"], [...WORKSPACE, ...RAIL, "chrome"], TEXT);
// The current rail item, and the account's initials, on its strongest fill.
each(["fg", "accent-text"], ["selected"], TEXT);
// Links, and the current rail item's icon.
each(["accent-text"], ["canvas", "surface", "field", ...RAIL], TEXT);
// Primary buttons in every state.
each(["on-accent"], ["accent", "accent-hover", "accent-pressed"], TEXT);
// The primary button's edge defines it on every surface it is placed on —
// a design-system rule: WCAG 1.4.11 does not require a boundary on a
// button its text already identifies.
each(["accent-rim"], ["canvas", "surface", "sunken"], UI);
// Feedback: tone text on its tint and on plain surfaces; body text in alerts.
for (const tone of ["danger", "warning", "success", "info"]) {
  each([`${tone}-text`], [`${tone}-subtle`, "canvas", "surface", "field"], TEXT);
  each(["fg", "fg-muted"], [`${tone}-subtle`], TEXT);
}
// The situation strip.
each(["ink-fg", "ink-muted"], ["ink", "ink-raised", "ink-hover"], TEXT);
each(["ink-accent"], ["ink", "ink-raised"], UI);
// Control boundaries, focus, and state marks.
each(["line-control"], ["field", "canvas", "surface", "sunken"], UI);
each(["focus"], [...WORKSPACE, ...RAIL, "selected"], UI);
// The current rail item's edge, on its fill and on the rail around it.
each(["accent-mark"], ["selected", ...RAIL], UI);
each(["danger-solid"], ["field"], UI);
// Signal colours work as marks on every surface they are drawn on.
each(
  [
    "signal-critical",
    "signal-high",
    "signal-caution",
    "signal-nominal",
    "signal-advisory",
    "signal-inactive",
  ],
  // `hover`: a hovered incident row keeps its severity mark legible;
  // `sunken`: the all-clear mark in an empty list.
  ["canvas", "surface", "hover", "sunken"],
  UI,
);

/**
 * The activity ramps (activity-calendar.tsx). A density scale, not a set of
 * marks, so the rule is its own: each step must be *told apart* from the
 * surface it is drawn on and from the step below it, and the busiest steps
 * must read as marks in their own right. What no step has to do is carry
 * the meaning alone — the square's size steps with its level too — so the
 * first, palest step is held to visibility rather than to 1.4.11's 3:1.
 */
const RAMPS = ["operational", "personal"] as const;
const SURFACES = ["surface", "canvas"];
/** The least contrast each step owes the surface under it. */
const STEP_MINIMUM = [1.25, 1.9, UI, 4.5];

describe("design tokens", () => {
  it("parses the colour tokens", () => {
    expect(tokens.size).toBeGreaterThan(40);
  });

  describe.each<Theme>(["light", "dark"])("%s theme", (theme) => {
    it.each(pairs)("%s on %s ≥ %d:1", (fg, bg, minimum) => {
      const ratio = contrast(colour(fg, theme), colour(bg, theme));

      expect(
        ratio,
        `${fg} ${colour(fg, theme)} on ${bg} ${colour(bg, theme)}`,
      ).toBeGreaterThanOrEqual(minimum);
    });

    describe.each(RAMPS)("the %s activity ramp", (ramp) => {
      const step = (level: number) => colour(`activity-${ramp}-${level}`, theme);

      it.each(SURFACES)("separates every step from %s", (surface) => {
        STEP_MINIMUM.forEach((minimum, index) => {
          const level = index + 1;
          const ratio = contrast(step(level), colour(surface, theme));

          expect(ratio, `level ${level} on ${surface}`).toBeGreaterThanOrEqual(
            minimum,
          );
        });
      });

      it("darkens in light and lightens in dark, one step at a time", () => {
        const ramped = [
          colour("activity-empty", theme),
          ...[1, 2, 3, 4].map(step),
        ].map(luminance);

        for (let index = 1; index < ramped.length; index += 1) {
          const rising = ramped[index] > ramped[index - 1];

          expect(rising, `level ${index} against the one below it`).toBe(
            theme === "dark",
          );
        }
      });
    });
  });
});

/**
 * Tailwind emits nothing for a class it does not know, so a raw palette
 * utility (`bg-slate-50`) would silently render as nothing now that the
 * default palette is removed. Colour comes from semantic tokens only, and
 * themes from the tokens — never a `dark:` variant.
 */
describe("component styling", () => {
  const PALETTE =
    /\b(?:bg|text|border|divide|ring|outline|fill|stroke|from|via|to|placeholder|decoration|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/;
  const DARK_VARIANT = /(?:^|[\s"'`])dark:/;

  const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => relative(SRC, join(SRC, file)));

  it("finds the component sources", () => {
    expect(sources.length).toBeGreaterThan(30);
  });

  it("uses no raw palette colours and no dark: variants", () => {
    const offenders = sources.flatMap((file) =>
      readFileSync(join(SRC, file), "utf8")
        .split("\n")
        .flatMap((line, index) =>
          PALETTE.test(line) || DARK_VARIANT.test(line)
            ? [`${file}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );

    expect(offenders).toEqual([]);
  });
});
