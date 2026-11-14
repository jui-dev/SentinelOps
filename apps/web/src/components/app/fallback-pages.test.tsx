import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorContent, NotFoundContent } from "./fallback-pages";

describe("fallback pages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says a page was not found, with a way to the workspace", () => {
    render(<NotFoundContent />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Go to your workspace" })
        .getAttribute("href"),
    ).toBe("/");
  });

  it("offers another try and a way out, quoting the reference but never the message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const error = Object.assign(new Error("secret internals: db password"), {
      digest: "4127839201",
    });

    render(<ErrorContent error={error} retry={retry} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" }),
    ).toBeDefined();
    expect(screen.getByText("4127839201")).toBeDefined();
    expect(document.body.textContent).not.toContain("secret internals");
    // Logged for whoever is debugging.
    expect(logged).toHaveBeenCalledWith(error);

    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledOnce();
    expect(
      screen
        .getByRole("link", { name: "Go to your workspace" })
        .getAttribute("href"),
    ).toBe("/");
  });

  it("names no reference when the error has none, and can sit under a page's own heading", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<ErrorContent error={new Error("x")} retry={() => {}} headingLevel={2} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Something went wrong" }),
    ).toBeDefined();
    expect(screen.queryByText(/Reference/)).toBeNull();
  });
});
