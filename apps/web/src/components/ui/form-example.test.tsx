import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";

import { FormExample } from "./form-example";

const FIELDS = [
  { label: "Title", value: "Card payments failing at checkout" },
  { label: "Service", value: "Payment API", half: true },
  { label: "Severity", value: "SEV1 Critical", half: true },
];

describe("FormExample", () => {
  it("stays closed until asked for, then shows the whole example", async () => {
    const user = userEvent.setup();
    const { container } = render(<FormExample fields={FIELDS} />);
    const details = container.querySelector("details");

    expect(details?.open).toBe(false);

    await user.click(screen.getByText("Not sure what to write? See a good example"));

    expect(details?.open).toBe(true);
    expect(screen.getByText("Title").nextSibling?.textContent).toBe(
      "Card payments failing at checkout",
    );
    expect(screen.getByText("Only an example. Nothing here is saved.")).toBeDefined();
  });

  it("does not submit the form around it", async () => {
    const user = userEvent.setup();
    let submitted = false;

    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <FormExample fields={FIELDS} />
      </form>,
    );

    await user.click(screen.getByText("Not sure what to write? See a good example"));

    expect(submitted).toBe(false);
  });

  it("has no accessibility violations when open", async () => {
    const user = userEvent.setup();
    const { container } = render(<FormExample fields={FIELDS} />);

    await user.click(screen.getByText("Not sure what to write? See a good example"));
    await expectNoAxeViolations(container);
  });
});
