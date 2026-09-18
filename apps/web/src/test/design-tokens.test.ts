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
  /--color-([a-z-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\);/g,
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

// Body, secondary, and metadata text on every surface text sits on.
each(
  ["fg", "fg-muted", "fg-subtle"],
  ["canvas", "surface", "chrome", "field", "sunken", "hover"],
  TEXT,
);
// The current rail item.
each(["fg", "accent-text"], ["selected"], TEXT);
// Links.
each(["accent-text"], ["canvas", "surface", "chrome", "field"], TEXT);
// Primary buttons in every state.
each(["on-accent"], ["accent", "accent-hover", "accent-pressed"], TEXT);
// Feedback: tone text on its tint and on plain surfaces; body text in alerts.
for (const tone of ["danger", "warning", "success", "info"]) {
  each([`${tone}-text`], [`${tone}-subtle`, "canvas", "surface", "field"], TEXT);
  each(["fg", "fg-muted"], [`${tone}-subtle`], TEXT);
}
// The situation strip.
each(["ink-fg", "ink-muted"], ["ink", "ink-hover"], TEXT);
each(["ink-accent"], ["ink"], UI);
// Control boundaries, focus, and state marks.
each(["line-control"], ["field", "canvas", "surface"], UI);
each(["focus"], ["canvas", "surface", "chrome", "field"], UI);
each(["accent"], ["selected", "chrome"], UI);
each(["danger-solid"], ["field"], UI);
// Reserved signal colours must already work as marks on every surface.
each(
  [
    "signal-critical",
    "signal-high",
    "signal-caution",
    "signal-nominal",
    "signal-advisory",
    "signal-inactive",
  ],
  ["canvas", "surface", "chrome"],
  UI,
);

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
