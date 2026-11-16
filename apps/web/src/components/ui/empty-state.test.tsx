import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyNote, NoMatches } from "./empty-state";

/** The tile's colour classes say which kind of emptiness it is. */
const tileOf = (container: HTMLElement) =>
  container.querySelector("[aria-hidden='true']")?.className ?? "";

describe("empty states", () => {
  it("says a section is empty in a neutral tile, with what it means", () => {
    const { container } = render(
      <EmptyNote title="None resolved yet">Resolved incidents appear here.</EmptyNote>,
    );

    expect(screen.getByText("None resolved yet")).toBeDefined();
    expect(screen.getByText("Resolved incidents appear here.")).toBeDefined();
    expect(tileOf(container)).toMatch(/bg-accent-subtle/);
  });

  it("makes good news teal, whether asked for or given the nominal mark", () => {
    const asked = render(<EmptyNote kind="good" title="No active incidents" />);

    expect(tileOf(asked.container)).toMatch(/bg-status-resolved-subtle/);
    asked.unmount();

    const marked = render(<EmptyNote glyph={<svg />} title="No active incidents" />);

    expect(tileOf(marked.container)).toMatch(/bg-status-resolved-subtle/);
  });

  it("offers the way back from filters that match nothing, only when given one", () => {
    const { rerender } = render(<NoMatches title="No members match" />);

    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <NoMatches title="No members match" action={<button type="button">Show everyone</button>} />,
    );

    expect(screen.getByRole("button", { name: "Show everyone" })).toBeDefined();
  });
});
