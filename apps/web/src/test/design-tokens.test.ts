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
// The chosen day's inset (activity-panes.tsx, tone="navy"), and the
// hovered row inside it. Everything drawn there reads through the roles the
// `ink-region` utility rebinds, so what is checked is what it binds them to.
const INSET = ["ink-inset", "ink-inset-hover"];
each(["ink-fg", "ink-inset-muted", "ink-accent-text"], INSET, TEXT);
each(["ink-focus"], INSET, UI);
// Severity on ink: the marks must still read as marks there.
each(
  [
    "ink-signal-critical",
    "ink-signal-high",
    "ink-signal-caution",
    "ink-signal-nominal",
    "ink-signal-advisory",
    "ink-signal-inactive",
  ],
  INSET,
  UI,
);
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

// Lifecycle (severity.tsx, StatusMark). As a pill, its word on its own tint;
// as a glyph — a responder's dot, a work list's circle — a mark on every
// surface it is drawn on, including the accent tint of a list that asks
// for a decision.
const LIFECYCLE = ["declared", "investigating", "resolved"];
for (const state of LIFECYCLE) {
  each([`status-${state}-text`], [`status-${state}-subtle`], TEXT);
  each(
    [`status-${state}-text`],
    ["canvas", "surface", "hover", "accent-subtle"],
    UI,
  );
  // As words — "Investigating", "Response complete" — on the plain
  // surfaces, and prose inside a frame on its own tint.
  each([`status-${state}-text`], ["canvas", "surface"], TEXT);
  each(["fg", "fg-muted"], [`status-${state}-subtle`], TEXT);
}

// A section and a list that wait on the reader's decision: the accent's
// tint, with body, secondary, and link text on it (overview-panel.tsx,
// tone="action"; operational-attention.tsx, the pending frame).
each(["fg", "fg-muted", "accent-text"], ["accent-subtle"], TEXT);
// The rule along the top of a section waiting on a decision, and the solid
// count in its header (its rim is what bounds it on the dark surface).
each(["accent-mark"], ["surface"], UI);
each(["accent-rim"], ["thead"], UI);

// The last thirty days' two views (incident-trend.tsx,
// services-under-pressure.tsx): each mark reads on the surface it is drawn
// on, and the share bar on its track too.
each(["trend-bar", "trend-line", "pressure-bar"], ["surface"], UI);
each(["pressure-bar"], ["line-subtle"], UI);
// The operational posture strip: its words, and the status and severity
// marks it counts.
each(["fg", "fg-muted", "fg-subtle"], ["summary"], TEXT);
each(
  [
    "signal-critical",
    "signal-high",
    "signal-caution",
    "signal-advisory",
    ...LIFECYCLE.map((state) => `status-${state}-text`),
  ],
  ["summary"],
  UI,
);

// Criticality (criticality-mark.tsx): neutrals only. The solid Critical
// chip turns the strongest ink into the ground; the others are text on the
// surface a row sits on, already held above.
each(["canvas", "surface"], ["fg"], TEXT);
each(["fg"], ["sunken"], TEXT);

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

/** A colour in OKLab, where distance is how different two colours look. */
const oklab = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;

    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [l, m, s] = [
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  ].map(Math.cbrt);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const apart = (a: string, b: string) => {
  const [x, y] = [oklab(a), oklab(b)];

  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

/**
 * How far apart two vocabularies' colours must look: several times the
 * smallest difference an eye notices (about 0.02), so a lifecycle pill is
 * never mistaken for a link, a severity, or a feedback tone — the things
 * it shares a row with.
 */
const DISTINCT = 0.08;

/**
 * The looser distance a lifecycle colour keeps from the analytical and
 * activity colours. Those are never drawn beside a pill, nor in its form —
 * a bar, a line, a square of a calendar — so they need only be plainly
 * different (about two and a half times the least noticeable difference),
 * not a vocabulary apart. The palette's blues and aquas sit too close
 * together for the stricter distance to hold across all of them at once.
 */
const APART = 0.05;

describe("semantic vocabularies", () => {
  const LIFECYCLE_TEXT = ["declared", "investigating", "resolved"].map(
    (state) => `status-${state}-text`,
  );
  /** Every vocabulary's colour a lifecycle pill shares a row with. */
  const OTHERS = [
    "accent-text",
    "accent-mark",
    "accent",
    "info-text",
    "warning-text",
    "danger-text",
    // Resolved and generic success are different ideas.
    "success-text",
    "signal-critical",
    "signal-high",
    "signal-caution",
    "signal-advisory",
  ];
  /** The analytical and activity colours, never drawn beside a pill. */
  const DRAWN = [
    "trend-bar",
    "trend-line",
    "pressure-bar",
    ...[1, 2, 3, 4].flatMap((level) => [
      `activity-operational-${level}`,
      `activity-personal-${level}`,
      `activity-ink-operational-${level}`,
      `activity-ink-personal-${level}`,
    ]),
  ];

  describe.each<Theme>(["light", "dark"])("in %s", (theme) => {
    it.each(LIFECYCLE_TEXT)("keeps %s apart from every other vocabulary", (state) => {
      for (const other of OTHERS) {
        expect(
          apart(colour(state, theme), colour(other, theme)),
          `${state} against ${other}`,
        ).toBeGreaterThanOrEqual(DISTINCT);
      }
    });

    it.each(LIFECYCLE_TEXT)("keeps %s clear of the charts and the calendar", (state) => {
      for (const other of DRAWN) {
        expect(
          apart(colour(state, theme), colour(other, theme)),
          `${state} against ${other}`,
        ).toBeGreaterThanOrEqual(APART);
      }
    });

    it("keeps the three lifecycle states apart from each other", () => {
      for (const [a, b] of [
        [LIFECYCLE_TEXT[0], LIFECYCLE_TEXT[1]],
        [LIFECYCLE_TEXT[1], LIFECYCLE_TEXT[2]],
        [LIFECYCLE_TEXT[0], LIFECYCLE_TEXT[2]],
      ]) {
        expect(apart(colour(a, theme), colour(b, theme)), `${a} against ${b}`)
          .toBeGreaterThanOrEqual(DISTINCT);
      }
    });

    // The one deliberate sharing: resolved and the nominal signal both say
    // "done, nothing wrong", so they are the same teal.
    it("shares its teal's hue with the nominal signal on purpose", () => {
      const hue = (name: string) => {
        const [, a, b] = oklab(colour(name, theme));

        return (Math.atan2(b, a) * 180) / Math.PI;
      };

      expect(
        Math.abs(hue("status-resolved-text") - hue("signal-nominal")),
      ).toBeLessThan(10);
    });
  });
});

/** OKLab back to a hex colour, clamped into sRGB. */
const fromOklab = ([L, a, b]: [number, number, number]): string => {
  const [l, m, s] = [
    L + 0.3963377774 * a + 0.2158037573 * b,
    L - 0.1055613458 * a - 0.0638541728 * b,
    L - 0.0894841775 * a - 1.291485548 * b,
  ].map((x) => x ** 3);
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return `#${linear
    .map((x) => {
      const clamped = Math.min(1, Math.max(0, x));
      const encoded =
        clamped <= 0.0031308
          ? 12.92 * clamped
          : 1.055 * clamped ** (1 / 2.4) - 0.055;

      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
};

/** `color-mix(in oklab, a p%, b)`, as the browser computes it. */
const mix = (a: string, share: number, b: string): string => {
  const [x, y] = [oklab(a), oklab(b)];

  return fromOklab([0, 1, 2].map((i) => x[i] * share + y[i] * (1 - share)) as [
    number,
    number,
    number,
  ]);
};

/**
 * The metric cards' tints (`tint-family`, `tint-family-tile`). Their grounds
 * are mixes no token names, so the parser above never sees them: they are
 * mixed here with the same percentages, in every family a card can take.
 */
describe.each<Theme>(["light", "dark"])("the metric cards in %s", (theme) => {
  const FAMILIES = [
    "signal-critical",
    "signal-high",
    "signal-caution",
    "signal-advisory",
    "signal-nominal",
    "fg-muted",
    "status-investigating-text",
    "status-resolved-text",
    "service-mark",
  ];
  const tint = css.match(
    /@utility tint-family \{[^}]*var\(--family\) (\d+)%, var\(--color-surface\)/,
  );
  const disc = css.match(
    /@utility tint-family-tile \{[^}]*var\(--family\) (\d+)%, transparent/,
  );

  it("mixes as the stylesheet says", () => {
    expect(tint?.[1]).toBeDefined();
    expect(disc?.[1]).toBeDefined();
  });

  it.each(FAMILIES)("keeps a %s card's text and icon legible", (family) => {
    const ground = mix(colour(family, theme), Number(tint![1]) / 100, colour("surface", theme));
    const disc_ = mix(colour(family, theme), Number(disc![1]) / 100, ground);

    for (const text of ["fg", "fg-muted"]) {
      expect(
        contrast(colour(text, theme), ground),
        `${text} on a ${family} card`,
      ).toBeGreaterThanOrEqual(TEXT);
    }
    expect(
      contrast(colour(family, theme), disc_),
      `the ${family} icon on its tile`,
    ).toBeGreaterThanOrEqual(UI);
  });
});

describe("design tokens", () => {
  it("parses the colour tokens", () => {
    expect(tokens.size).toBeGreaterThan(40);
  });

  /**
   * The type utilities the README documents and components are written
   * with. Tailwind emits nothing for a class it does not know, so one
   * removed by accident fails silently everywhere it is used — `data` once
   * did, and identifiers and durations fell back to the body face.
   */
  it("defines every documented type utility", () => {
    for (const utility of ["label-caps", "eyebrow", "numeric"]) {
      expect(css, utility).toMatch(new RegExp(`@utility ${utility} \\{`));
    }
    // A component class, so a size utility beside it always wins.
    expect(css).toMatch(
      /@layer components \{\s*\.data \{[^}]*font-family: var\(--font-mono\);[^}]*tabular-nums/,
    );
  });

  /**
   * The two ink panels sit side by side inside one section panel, and the
   * chosen day's inset is the raised of the two. None of these is a text or a mark
   * pair, so none owes 3:1 — what they owe is being told apart, which the
   * system elsewhere leaves to a border alone.
   */
  describe.each<Theme>(["light", "dark"])("the ink panels in %s", (theme) => {
    const step = (a: string, b: string) =>
      contrast(colour(a, theme), colour(b, theme));

    it("raises the inset off the calendar's ink", () => {
      expect(step("ink-inset", "ink")).toBeGreaterThanOrEqual(1.2);
    });

    it("bounds and hovers the inset with lines of its own", () => {
      expect(step("ink-inset-line", "ink-inset")).toBeGreaterThanOrEqual(1.25);
      expect(step("ink-inset-hover", "ink-inset")).toBeGreaterThanOrEqual(1.09);
    });
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

    describe.each(RAMPS)("the %s activity ramp on ink", (ramp) => {
      const step = (level: number) =>
        colour(`activity-ink-${ramp}-${level}`, theme);

      it("separates every step from ink", () => {
        STEP_MINIMUM.forEach((minimum, index) => {
          const level = index + 1;
          const ratio = contrast(step(level), colour("ink", theme));

          expect(ratio, `level ${level} on ink`).toBeGreaterThanOrEqual(
            minimum,
          );
        });
      });

      // The ink panel is dark in both themes, so this ramp lightens in
      // both — the one place the rule above does not hold.
      it("lightens in both themes, one step at a time", () => {
        const ramped = [
          colour("activity-ink-empty", theme),
          ...[1, 2, 3, 4].map(step),
        ].map(luminance);

        for (let index = 1; index < ramped.length; index += 1) {
          expect(
            ramped[index] > ramped[index - 1],
            `level ${index} against the one below it`,
          ).toBe(true);
        }
      });

      // A day nothing happened on is a slot, not a mark: the hairline is
      // what carries it, so it is held only to being visible at all.
      it("keeps the empty slot off the panel", () => {
        expect(
          contrast(colour("activity-ink-empty", theme), colour("ink", theme)),
        ).toBeGreaterThanOrEqual(1.25);
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
