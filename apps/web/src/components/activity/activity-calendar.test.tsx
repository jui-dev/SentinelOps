import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ActivityCalendar } from "@/components/activity/activity-calendar";
import type { ActivityVariant } from "@/components/activity/activity-calendar";
import type { ActivityDay, ActivityLevel } from "@/lib/activity/calendar";
import { expectNoAxeViolations } from "@/test/axe";

/**
 * The shared calendar, on its own: it is handed days that already carry
 * their level, and draws them. Nothing here knows what the activity was —
 * that is the feature's, and is proven against the APIs in the API suites.
 */

const DAY_MS = 86_400_000;

/** 2026-03-22 is a Sunday; 26 weeks of it end on Saturday 2026-09-19. */
const SUNDAY = "2026-03-22";
const LAST = "2026-09-19";
const WEEKS = 26;

/** A date as the reader's locale writes it — what the labels are built on. */
const formatDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);

  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const dateAt = (from: string, index: number) =>
  new Date(Date.parse(`${from}T00:00:00.000Z`) + index * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** A run of days, quiet unless `levels` names one. */
const run = (
  from: string,
  count: number,
  levels: Record<string, ActivityLevel> = {},
): ActivityDay[] =>
  Array.from({ length: count }, (_, index) => {
    const date = dateAt(from, index);
    const level = levels[date] ?? 0;

    return { date, total: level === 0 ? 0 : level * 3, level };
  });

const SIX_MONTHS = run(SUNDAY, WEEKS * 7);

const calendar = (props: Partial<Parameters<typeof ActivityCalendar>[0]> = {}) =>
  render(
    <ActivityCalendar
      days={SIX_MONTHS}
      label="Operational activity"
      variant="operational"
      selected={null}
      onSelect={vi.fn()}
      {...props}
    />,
  );

const grid = () => screen.getByRole("grid", { name: "Operational activity" });
const rows = () => within(grid()).getAllByRole("row");
const dayButtons = () => within(grid()).getAllByRole("button");

/** A day's button, by the date in its accessible name. */
const dayOn = (date: string) =>
  screen.getByRole("button", {
    // The most recent day says so, between its date and what it holds.
    name: new RegExp(`^${formatDate(date)}( \\(today\\))? —`),
  });

describe("the activity calendar", () => {
  describe("its shape", () => {
    it("lays 26 weeks out as seven Sunday-to-Saturday rows", () => {
      calendar();

      // One row per weekday, each a rowheader and 26 columns.
      expect(rows()).toHaveLength(7);
      expect(
        rows().map((row) => within(row).getAllByRole("gridcell").length),
      ).toEqual(Array.from({ length: 7 }, () => WEEKS));
    });

    it("names its rows Sunday first and Saturday last", () => {
      calendar();

      expect(
        rows().map(
          (row) => within(row).getByRole("rowheader").textContent,
        ),
      ).toEqual([
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ]);
    });

    it("puts each date in the row its weekday belongs to", () => {
      calendar();

      const sunday = rows()[0];
      const saturday = rows()[6];

      // The first column's ends, and the last column's.
      expect(within(sunday).getAllByRole("button")[0]).toBe(dayOn(SUNDAY));
      expect(within(saturday).getAllByRole("button")[0]).toBe(
        dayOn("2026-03-28"),
      );
      expect(within(saturday).getAllByRole("button").at(-1)).toBe(dayOn(LAST));
    });

    it("is one day per date, and no more", () => {
      calendar();

      expect(dayButtons()).toHaveLength(WEEKS * 7);
    });

    it("pads a range that does not begin on a Sunday", () => {
      // 2026-03-25 is a Wednesday: Sunday to Tuesday have no day behind them.
      calendar({ days: run("2026-03-25", 10) });

      const first = within(rows()[0]).getAllByRole("gridcell")[0];

      expect(within(first).queryByRole("button")).toBeNull();
      // Not a day of the range at all, so not even an outline.
      expect(first.querySelector("[data-future]")).toBeNull();
    });

    it("shows nothing at all when there are no days", () => {
      const { container } = calendar({ days: [] });

      expect(container.innerHTML).toBe("");
    });
  });

  describe("months", () => {
    it("names each month once, above the column it begins in", () => {
      calendar();

      // March to September: the labels are decorative, so they are read off
      // the rendered text rather than by role.
      const labels = screen.getByText("Mar").parentElement as HTMLElement;

      expect(
        [...labels.children].map((child) => child.textContent),
      ).toEqual(["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"]);
    });

    it("leaves the leftmost column unnamed when its month ends at once", () => {
      // From 2026-03-29, the first column is March's last and the second
      // begins April: two names would land side by side.
      calendar({ days: run("2026-03-29", WEEKS * 7) });

      expect(screen.queryByText("Mar")).toBeNull();
      expect(screen.getByText("Apr")).toBeDefined();
    });
  });

  describe("intensity", () => {
    const levels: Record<string, ActivityLevel> = {
      "2026-03-23": 1,
      "2026-03-24": 2,
      "2026-03-25": 3,
      "2026-03-26": 4,
    };

    it("draws all five levels, each in its own fill", () => {
      calendar({ days: run(SUNDAY, 7, levels) });

      // Quiet, then the four steps.
      expect(dayOn(SUNDAY).dataset.level).toBe("0");
      expect(dayOn("2026-03-23").dataset.level).toBe("1");
      expect(dayOn("2026-03-24").dataset.level).toBe("2");
      expect(dayOn("2026-03-25").dataset.level).toBe("3");
      expect(dayOn("2026-03-26").dataset.level).toBe("4");

      const fillOf = (date: string) =>
        dayOn(date).firstElementChild?.className ?? "";

      // Each step is its own token, and they are all distinct.
      const fills = [
        "2026-03-23",
        "2026-03-24",
        "2026-03-25",
        "2026-03-26",
      ].map(fillOf);

      expect(new Set(fills).size).toBe(4);
      fills.forEach((fill, index) =>
        expect(fill).toContain(`bg-activity-operational-${index + 1}`),
      );
    });

    it("gives every day the same square, whatever happened on it", () => {
      calendar({ days: run(SUNDAY, 7, levels) });

      // Intensity is the ramp's alone: nothing grows with the level.
      for (const date of [
        SUNDAY,
        "2026-03-23",
        "2026-03-24",
        "2026-03-25",
        "2026-03-26",
      ]) {
        const fill = dayOn(date).firstElementChild as HTMLElement;

        expect(fill.className).toMatch(/size-full/);
        expect(fill.className).not.toMatch(/size-\[\d+px\]/);
        expect(dayOn(date).parentElement?.className).toMatch(/size-\[15px\]/);
      }
    });

    it("keeps a quiet day quiet, and tells it from a faint one", () => {
      calendar({ days: run(SUNDAY, 7, levels) });

      expect(dayOn(SUNDAY).getAttribute("aria-label")).toMatch(/no activity$/);

      const quiet = dayOn(SUNDAY).firstElementChild?.className ?? "";

      // No blue at all, and an edge — so it reads as an empty slot rather
      // than as the palest step of the ramp, which it sits close to.
      expect(quiet).toMatch(/bg-activity-empty/);
      expect(quiet).toMatch(/border-line/);
      expect(quiet).not.toMatch(/bg-activity-operational/);
      expect(dayOn("2026-03-23").firstElementChild?.className).not.toMatch(
        /border-line/,
      );
    });

    it.each<[ActivityVariant, string]>([
      ["operational", "bg-activity-operational-"],
      ["personal", "bg-activity-personal-"],
    ])("draws the %s variant from its own family", (variant, family) => {
      calendar({ days: run(SUNDAY, 7, levels), variant });

      for (const level of [1, 2, 3, 4]) {
        const date = `2026-03-2${2 + level}`;

        expect(dayOn(date).firstElementChild?.className).toContain(
          `${family}${level}`,
        );
      }
      // A quiet day has no domain, so it has no family either.
      expect(dayOn(SUNDAY).firstElementChild?.className).toMatch(
        /bg-activity-empty/,
      );
    });

    it("uses no signal or accent colour for intensity", () => {
      const { container } = calendar({ days: run(SUNDAY, 7, levels) });

      expect(container.innerHTML).not.toMatch(/bg-signal-/);
      expect(container.innerHTML).not.toMatch(/bg-accent/);
    });
  });

  describe("days that have not happened", () => {
    it("draws them as still to come rather than as quiet days", () => {
      // Read on the Wednesday of the first week.
      calendar({ days: run(SUNDAY, 7), today: "2026-03-25" });

      const cells = within(rows()[0]).getAllByRole("gridcell");

      expect(dayOn("2026-03-25")).toBeDefined();
      // Thursday on has no day behind it, so nothing to focus or choose.
      expect(dayButtons()).toHaveLength(4);
      expect(within(cells[0]).queryByRole("button")).not.toBeNull();
      expect(
        within(rows()[4]).getAllByRole("gridcell")[0].querySelector("button"),
      ).toBeNull();
    });

    it("gives a day still to come no name and no level", () => {
      calendar({ days: run(SUNDAY, 7), today: "2026-03-25" });

      const friday = within(rows()[5]).getAllByRole("gridcell")[0];

      expect(within(friday).queryByRole("button")).toBeNull();
      expect(friday.querySelector("[data-future]")).not.toBeNull();
    });

    it("keeps every day of a range whose days have not all happened", () => {
      // A fortnight of range, a week of it lived through.
      calendar({
        days: run(SUNDAY, 7),
        today: "2026-03-28",
        range: { from: SUNDAY, to: "2026-04-04" },
      });

      // Seven lived days, seven still to come, and nothing blank between.
      expect(dayButtons()).toHaveLength(7);
      expect(
        grid().querySelectorAll("[data-future]"),
      ).toHaveLength(7);
    });
  });

  describe("today", () => {
    it("marks it, and says so in its name", () => {
      calendar({ days: run(SUNDAY, 7), today: "2026-03-25" });

      const today = dayOn("2026-03-25");

      expect(today.dataset.today).toBe("true");
      expect(today.getAttribute("aria-label")).toMatch(/\(today\)/);
      // An edge of its own, quieter than a selection's.
      expect(today.className).toMatch(/after:border-accent-mark/);
    });

    it("marks no other day", () => {
      calendar({ days: run(SUNDAY, 7), today: "2026-03-25" });

      expect(
        dayButtons().filter((button) => button.dataset.today === "true"),
      ).toHaveLength(1);
      expect(dayOn(SUNDAY).dataset.today).toBeUndefined();
    });

    it("lets a selection take over its edge", () => {
      calendar({
        days: run(SUNDAY, 7),
        today: "2026-03-25",
        selected: "2026-03-25",
      });

      const today = dayOn("2026-03-25");

      expect(today.className).toMatch(/after:border-fg/);
      expect(today.className).not.toMatch(/after:border-accent-mark/);
    });
  });

  describe("choosing a day", () => {
    it("tells the parent which day was clicked", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();

      calendar({ onSelect });
      await user.click(dayOn("2026-04-01"));

      expect(onSelect).toHaveBeenCalledWith("2026-04-01");
    });

    it("marks the selected day, and only it", () => {
      calendar({ selected: "2026-04-01" });

      const cellOf = (date: string) =>
        dayOn(date).closest('[role="gridcell"]');

      expect(cellOf("2026-04-01")?.getAttribute("aria-selected")).toBe("true");
      expect(cellOf("2026-04-02")?.getAttribute("aria-selected")).toBe("false");
      // Selection is an edge of its own, so it reads beside a focus ring.
      expect(dayOn("2026-04-01").className).toMatch(/after:border-fg/);
      expect(dayOn("2026-04-02").className).not.toMatch(/after:border-fg/);
    });

    it("clears the selection on Escape, and does nothing without one", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();

      const { rerender } = render(
        <ActivityCalendar
          days={SIX_MONTHS}
          label="Operational activity"
          variant="operational"
          selected={null}
          onSelect={onSelect}
        />,
      );

      dayOn(LAST).focus();
      await user.keyboard("{Escape}");
      expect(onSelect).not.toHaveBeenCalled();

      rerender(
        <ActivityCalendar
          days={SIX_MONTHS}
          label="Operational activity"
          variant="operational"
          selected={LAST}
          onSelect={onSelect}
        />,
      );

      dayOn(LAST).focus();
      await user.keyboard("{Escape}");
      expect(onSelect).toHaveBeenCalledWith(null);
    });
  });

  describe("the keyboard", () => {
    /** Selection held by a parent, as the features will hold it. */
    function Controlled() {
      const [selected, setSelected] = useState<string | null>(null);

      return (
        <ActivityCalendar
          days={SIX_MONTHS}
          label="Operational activity"
          variant="operational"
          selected={selected}
          onSelect={setSelected}
        />
      );
    }

    it("is one tab stop, resting on the most recent day", async () => {
      const user = userEvent.setup();

      calendar();
      await user.tab();

      expect(document.activeElement).toBe(dayOn(LAST));
      expect(
        dayButtons().filter((button) => button.tabIndex === 0),
      ).toHaveLength(1);
    });

    it("moves a day down the column and back up it", async () => {
      const user = userEvent.setup();

      calendar();
      dayOn("2026-05-13").focus();

      await user.keyboard("{ArrowDown}");
      expect(document.activeElement).toBe(dayOn("2026-05-14"));

      await user.keyboard("{ArrowUp}{ArrowUp}");
      expect(document.activeElement).toBe(dayOn("2026-05-12"));
    });

    it("carries on into the next column at a week's edge", async () => {
      const user = userEvent.setup();

      calendar();
      // 2026-05-16 is a Saturday; the next day begins the next column.
      dayOn("2026-05-16").focus();

      await user.keyboard("{ArrowDown}");
      expect(document.activeElement).toBe(dayOn("2026-05-17"));

      await user.keyboard("{ArrowUp}");
      expect(document.activeElement).toBe(dayOn("2026-05-16"));
    });

    it("moves a week across, keeping the weekday", async () => {
      const user = userEvent.setup();

      calendar();
      dayOn("2026-05-13").focus();

      await user.keyboard("{ArrowRight}");
      expect(document.activeElement).toBe(dayOn("2026-05-20"));

      await user.keyboard("{ArrowLeft}{ArrowLeft}");
      expect(document.activeElement).toBe(dayOn("2026-05-06"));
    });

    it("goes to the first day and the last, and stops at both ends", async () => {
      const user = userEvent.setup();

      calendar();
      dayOn("2026-05-13").focus();

      await user.keyboard("{Home}");
      expect(document.activeElement).toBe(dayOn(SUNDAY));

      await user.keyboard("{ArrowUp}{ArrowLeft}");
      expect(document.activeElement).toBe(dayOn(SUNDAY));

      await user.keyboard("{End}");
      expect(document.activeElement).toBe(dayOn(LAST));

      await user.keyboard("{ArrowDown}{ArrowRight}");
      expect(document.activeElement).toBe(dayOn(LAST));
    });

    it("chooses the focused day with Enter and with Space", async () => {
      const user = userEvent.setup();

      render(<Controlled />);
      dayOn("2026-05-13").focus();

      await user.keyboard("{Enter}");
      expect(
        dayOn("2026-05-13")
          .closest('[role="gridcell"]')
          ?.getAttribute("aria-selected"),
      ).toBe("true");

      await user.keyboard("{ArrowDown} ");
      expect(
        dayOn("2026-05-14")
          .closest('[role="gridcell"]')
          ?.getAttribute("aria-selected"),
      ).toBe("true");
      // Moving focus alone did not change what is chosen.
      expect(
        dayOn("2026-05-13")
          .closest('[role="gridcell"]')
          ?.getAttribute("aria-selected"),
      ).toBe("false");
    });

    it("keeps focus and selection apart", async () => {
      const user = userEvent.setup();

      render(<Controlled />);
      dayOn("2026-05-13").focus();
      await user.keyboard("{Enter}{ArrowDown}{ArrowDown}");

      // Focus has moved on; the chosen day has not.
      expect(document.activeElement).toBe(dayOn("2026-05-15"));
      expect(
        dayOn("2026-05-13")
          .closest('[role="gridcell"]')
          ?.getAttribute("aria-selected"),
      ).toBe("true");
    });
  });

  describe("what it says", () => {
    it("names a day by its date and what it holds", () => {
      calendar({ days: run(SUNDAY, 7, { "2026-03-24": 3 }) });

      expect(dayOn("2026-03-24").getAttribute("aria-label")).toBe(
        `${formatDate("2026-03-24")} — 9 events, level 3 of 4`,
      );
    });

    it("counts one event as one", () => {
      calendar({
        days: [{ date: SUNDAY, total: 1, level: 1 }],
      });

      // The only day given, so it is also the most recent one.
      expect(dayOn(SUNDAY).getAttribute("aria-label")).toBe(
        `${formatDate(SUNDAY)} (today) — 1 event, level 1 of 4`,
      );
    });

    it("lets the feature say what its days hold, in its own words", () => {
      calendar({
        days: run(SUNDAY, 7, { "2026-03-24": 2 }),
        describeDay: (day) => `${day.total} responses`,
      });

      expect(dayOn("2026-03-24").getAttribute("aria-label")).toBe(
        `${formatDate("2026-03-24")} — 6 responses`,
      );
    });

    it("hard-codes no domain wording of its own", () => {
      const { container } = calendar();

      expect(container.innerHTML).not.toMatch(/incident/i);
      expect(container.innerHTML).not.toMatch(/response/i);
    });

    it("is a read-only grid with the name the feature gave it", () => {
      calendar({ label: "Response activity" });

      const named = screen.getByRole("grid", { name: "Response activity" });

      expect(named.getAttribute("aria-readonly")).toBe("true");
    });

    it("explains its scale once, and puts no numbers in the grid", () => {
      calendar();

      expect(screen.getByText("Quiet")).toBeDefined();
      expect(screen.getByText("Busy")).toBeDefined();
      expect(within(grid()).queryByText(/^\d+$/)).toBeNull();
    });
  });

  describe("narrow screens", () => {
    it("scrolls the grid rather than shrinking its days", () => {
      const { container } = calendar();

      const scroller = container.querySelector(".overflow-x-auto");

      expect(scroller).not.toBeNull();
      // The weekday column is outside it, so the rows stay readable while
      // the weeks scroll past.
      expect(scroller?.contains(grid())).toBe(true);
      expect(scroller?.contains(screen.getByText("Mon"))).toBe(false);
    });

    it("names every weekday beside the grid", () => {
      calendar();

      // All seven, not every other one.
      for (const weekday of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
        expect(screen.getByText(weekday)).toBeDefined();
      }
    });

    it("sets the week columns two pixels apart, so a whole year fits", () => {
      calendar();

      // 53 columns of 15px cells two pixels apart is 899px of squares, which
      // leaves the calendar surface inside the width it is given at the
      // page's widest. Three pixels did not fit.
      const row = rows()[0];

      expect(row.className).toMatch(/gap-\[2px\]/);
      expect(row.parentElement?.className).toMatch(/gap-\[2px\]/);

      // The month labels are placed against the same pitch.
      const march = screen.getByText("Mar");
      const april = screen.getByText("Apr");
      const left = (label: HTMLElement) =>
        Number(label.style.left.replace("px", ""));

      expect((left(april) - left(march)) % 17).toBe(0);
    });

    it("gives the weekday names a column of their own", () => {
      const { container } = calendar();

      const labels = screen.getByText("Wed").parentElement as HTMLElement;

      // A width of its own, so a three-letter name sits inside the column
      // rather than spilling into the surface around it.
      expect(labels.className).toMatch(/w-9/);
      expect(labels.className).toMatch(/shrink-0/);
      expect(container.querySelector(".overflow-x-auto")?.contains(labels)).toBe(
        false,
      );
    });

    it("keeps every day the same size, at every width", () => {
      calendar();

      const sizes = new Set(
        dayButtons().map(
          (button) => button.parentElement?.className.match(/size-\[\d+px\]/)?.[0],
        ),
      );

      expect([...sizes]).toEqual(["size-[15px]"]);
    });

    it("gives the weeks a thin scrollbar rather than the browser's", () => {
      const { container } = calendar();

      const scroller = container.querySelector(".overflow-x-auto");

      // Still scrollable, and still a scrollbar: only a quieter one.
      expect(scroller?.className).toMatch(/scrollbar-thin/);
      expect(scroller?.className).toMatch(/overflow-x-auto/);
    });
  });

  it("has no accessibility violations", async () => {
    const { container } = calendar({ selected: "2026-04-01" });

    await expectNoAxeViolations(container);
  });

  it("has no accessibility violations in the personal variant", async () => {
    const { container } = calendar({
      variant: "personal",
      label: "Response activity",
      days: run(SUNDAY, 7, { "2026-03-24": 4 }),
    });

    await expectNoAxeViolations(container);
  });
});
