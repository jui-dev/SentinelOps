import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Field } from "./field";
import { RequiredNote, SubmitHint, useRequiredFields } from "./required";

function Form({ withGenerate = false }: { withGenerate?: boolean }) {
  const [code, setCode] = useState("");
  const { attach, ...required } = useRequiredFields(code);

  return (
    <form ref={attach} noValidate>
      <RequiredNote />
      <Field label="Name" name="name" required />
      <Field label="Email" name="email" type="email" required />
      <Field label="Note" name="note" optional />
      {withGenerate && (
        <>
          <Field
            label="Code"
            name="code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="button" onClick={() => setCode("generated")}>
            Generate
          </button>
        </>
      )}
      <SubmitHint id={required.hintId} missing={required.missing} />
      <button
        type="submit"
        disabled={!required.ready}
        aria-describedby={required.ready ? undefined : required.hintId}
      >
        Save
      </button>
    </form>
  );
}

const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;

describe("required fields", () => {
  it("marks required fields beside their labels, which stay the fields' names", () => {
    render(<Form />);

    // The label is the name exactly; the asterisk is beside it, unspoken.
    expect(screen.getByLabelText("Name").hasAttribute("required")).toBe(true);
    expect(screen.getByLabelText(/Note/).hasAttribute("required")).toBe(false);
    expect(screen.getByText("Required")).toBeDefined();
  });

  it("holds the button back, saying which fields are missing, until each has something", async () => {
    const user = userEvent.setup();
    render(<Form />);

    expect(save().disabled).toBe(true);
    expect(
      screen.getByText("Fill in Name and Email to continue."),
    ).toBeDefined();
    expect(save().getAttribute("aria-describedby")).toBe(
      screen.getByText(/to continue/).id,
    );

    await user.type(screen.getByLabelText("Name"), "Ada");
    await waitFor(() =>
      expect(screen.getByText("Fill in Email to continue.")).toBeDefined(),
    );

    // Only spaces is still empty.
    await user.type(screen.getByLabelText("Email"), "   ");
    expect(save().disabled).toBe(true);

    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await waitFor(() => expect(save().disabled).toBe(false));
    expect(screen.queryByText(/to continue/)).toBeNull();
    // The optional field never held it back.
  });

  it("counts a value set from code, when told to watch it", async () => {
    const user = userEvent.setup();
    render(<Form withGenerate />);

    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await waitFor(() =>
      expect(screen.getByText("Fill in Code to continue.")).toBeDefined(),
    );

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(save().disabled).toBe(false));
  });
});
