import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormDialog } from "./dialog";
import { MODAL_BACKDROP } from "./modal";

describe("FormDialog", () => {
  it("dims and blurs the page behind it, so the dialog holds the eye", () => {
    render(
      <FormDialog title="New team" onClose={vi.fn()}>
        <p>Form</p>
      </FormDialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "New team" });

    for (const backdrop of MODAL_BACKDROP.split(" ")) {
      expect(dialog.className).toContain(backdrop);
    }
    expect(MODAL_BACKDROP).toContain("backdrop:backdrop-blur");
  });
});
