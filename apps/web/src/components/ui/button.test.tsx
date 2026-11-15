import { render, screen } from "@testing-library/react";
import { Eye, Pencil } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Button, buttonClasses } from "./button";
import type { ButtonVariant } from "./button";
import { ButtonLink } from "./button-link";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** Each kind and the colour family it is drawn in. */
const KINDS: Record<ButtonVariant, string> = {
  primary: "bg-accent",
  complete: "bg-status-resolved-solid",
  view: "bg-accent-subtle",
  edit: "bg-warning-subtle",
  add: "bg-success-subtle",
  manage: "bg-manage-subtle",
  restore: "bg-info-subtle",
  destructive: "bg-danger-subtle",
  danger: "bg-danger-solid",
  secondary: "bg-surface",
  quiet: "hover:bg-hover",
};

describe("buttons", () => {
  it("gives every kind its own colour, so a colour means one thing", () => {
    for (const [variant, colour] of Object.entries(KINDS)) {
      expect(buttonClasses({ variant: variant as ButtonVariant })).toContain(colour);
    }

    const tinted = (["view", "edit", "add", "manage", "restore", "destructive"] as const).map(
      (variant) => buttonClasses({ variant }).match(/\bbg-[a-z-]+-subtle\b/)?.[0],
    );

    expect(new Set(tinted).size).toBe(tinted.length);
  });

  it("shows its icon before its words, hidden from assistive technology", () => {
    render(
      <Button variant="edit" icon={Pencil}>
        Edit
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Edit" });
    const icon = button.querySelector("svg");

    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(button.firstElementChild).toBe(icon);
  });

  it("draws a link that looks like a button with the same icon and colour", () => {
    render(
      <ButtonLink href="/teams/payments" icon={Eye} size="sm">
        View
      </ButtonLink>,
    );

    const link = screen.getByRole("link", { name: "View" });

    expect(link.getAttribute("href")).toBe("/teams/payments");
    expect(link.className).toContain("bg-accent-subtle");
    expect(link.querySelector("svg")).not.toBeNull();
  });
});
