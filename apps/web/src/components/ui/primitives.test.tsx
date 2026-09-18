import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { Alert, ErrorAlert } from "./alert";
import { Button } from "./button";
import { CopyField } from "./copy-field";
import { EmptyNote, EmptyState } from "./empty-state";
import { Field } from "./field";
import { Select } from "./select";
import { Status } from "./status";
import {
  stretchedLinkClasses,
  Table,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "./table";
import { Tabs } from "./tabs";
import { formatIsoDate, IsoDate } from "./timestamp";

describe("Button", () => {
  it("is a plain button unless told otherwise, so it never submits by accident", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" }).getAttribute("type")).toBe(
      "button",
    );
  });

  it("is named by its text, not its icon", () => {
    const Icon = (props: object) => <svg {...props} />;

    render(
      <Button variant="destructive" icon={Icon}>
        Revoke
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Revoke" })).toBeDefined();
  });
});

describe("Field", () => {
  it("wires its label, hint, and error for assistive technology", () => {
    render(<Field label="Email" hint="Work address" error="Invalid email" />);

    const input = screen.getByLabelText("Email");
    const described = input.getAttribute("aria-describedby")!.split(" ");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      "Work address",
      "Invalid email",
    ]);
  });

  it("marks optional fields in words", () => {
    render(<Field label="URL name" optional />);

    expect(screen.getByLabelText(/URL name/).getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("Optional")).toBeDefined();
  });
});

describe("Select", () => {
  it("is a labelled native select", () => {
    render(
      <Select label="Role" defaultValue="MEMBER">
        <option value="MEMBER">Member</option>
        <option value="ADMIN">Admin</option>
      </Select>,
    );

    expect(
      (screen.getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value,
    ).toBe("MEMBER");
  });
});

describe("Alert", () => {
  it("announces danger assertively and everything else politely", () => {
    render(
      <>
        <Alert>Failed</Alert>
        <Alert tone="success">Saved</Alert>
      </>,
    );

    expect(screen.getByRole("alert").textContent).toContain("Failed");
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });

  it("shows the request id of a failed API call", () => {
    render(
      <ErrorAlert
        error={
          new ApiError({
            statusCode: 500,
            message: "Something failed",
            requestId: "req-42",
          })
        }
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Something failed");
    expect(screen.getByText("req-42")).toBeDefined();
  });
});

describe("Status", () => {
  it("says the state in words; its glyph is decoration", () => {
    const { container } = render(<Status tone="warning">Expired</Status>);

    expect(screen.getByText("Expired")).toBeDefined();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("Tabs", () => {
  const MODES = [
    { value: "a", label: "First" },
    { value: "b", label: "Second" },
    { value: "c", label: "Third" },
  ] as const;

  function Harness() {
    const [value, setValue] = useState<"a" | "b" | "c">("a");

    return (
      <Tabs label="Modes" tabs={MODES} value={value} onChange={setValue}>
        <p>Panel {value}</p>
      </Tabs>
    );
  }

  it("follows the ARIA tabs pattern", () => {
    render(<Harness />);

    const [first, second] = screen.getAllByRole("tab");
    const panel = screen.getByRole("tabpanel");

    expect(screen.getByRole("tablist", { name: "Modes" })).toBeDefined();
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(second.getAttribute("tabindex")).toBe("-1");
    expect(first.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(first.id);
  });

  it("moves and selects with the arrow keys, Home, and End", async () => {
    const user = userEvent.setup();

    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "First" }));

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Second" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel b");

    await user.keyboard("{End}");
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel c");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel a");

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel c");

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "First" }));
  });
});

describe("Table", () => {
  it("is named, with column headers, and can say why it is empty", () => {
    render(
      <Table label="Members">
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Joined</TH>
          </TR>
        </THead>
        <TBody>
          <TableEmpty columns={2}>Nobody yet.</TableEmpty>
        </TBody>
      </Table>,
    );

    expect(screen.getByRole("table", { name: "Members" })).toBeDefined();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Name",
      "Joined",
    ]);
    expect(screen.getByRole("cell").getAttribute("colspan")).toBe("2");
  });

  it("keeps an interactive row to one link, and a sticky header to table semantics", () => {
    render(
      <Table label="Incidents" variant="operational" stickyHeader fixed>
        <THead>
          <TR>
            <TH>Incident</TH>
            <TH align="end">Duration</TH>
          </TR>
        </THead>
        <TBody>
          <TR interactive>
            <TD>
              <a href="/incidents/42" className={stretchedLinkClasses}>
                INC-42 Card payments failing
              </a>
            </TD>
            <TD kind="numeric" align="end">
              14
            </TD>
          </TR>
        </TBody>
      </Table>,
    );

    const table = screen.getByRole("table", { name: "Incidents" });
    const [, row] = screen.getAllByRole("row");

    expect(screen.getAllByRole("columnheader").map((th) => th.getAttribute("scope"))).toEqual([
      "col",
      "col",
    ]);
    expect(table.querySelectorAll("a")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "INC-42 Card payments failing" }).closest("tr"),
    ).toBe(row);
    expect(screen.getByRole("cell", { name: "14" })).toBeDefined();
  });

  it("is not a tab stop when it does not need scrolling", () => {
    const { container } = render(
      <Table label="Members">
        <TBody>
          <TR>
            <TD>Ada</TD>
          </TR>
        </TBody>
      </Table>,
    );

    expect(container.querySelector("[tabindex]")).toBeNull();
  });
});

describe("EmptyState", () => {
  it("titles itself at the heading level asked for, and plainly otherwise", () => {
    render(
      <>
        <EmptyState headingLevel={1} title="Incident not found" />
        <EmptyState title="No teams yet" />
      </>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Incident not found" })).toBeDefined();
    expect(screen.getByText("No teams yet").tagName).toBe("P");
  });
});

describe("EmptyNote", () => {
  it("says what is empty and what that means; its glyph is decoration", () => {
    const { container } = render(
      <EmptyNote title="No active incidents" glyph={<svg />}>
        Nothing needs a response right now.
      </EmptyNote>,
    );

    expect(screen.getByText("No active incidents")).toBeDefined();
    expect(screen.getByText("Nothing needs a response right now.")).toBeDefined();
    expect(container.querySelector("svg")?.closest("[aria-hidden]")).not.toBeNull();
  });
});

describe("IsoDate", () => {
  it("shows the UTC calendar date and keeps the instant machine-readable", () => {
    render(<IsoDate value="2026-09-18T23:30:00.000Z" />);

    const time = screen.getByText("2026-09-18");

    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("dateTime")).toBe("2026-09-18T23:30:00.000Z");
    expect(time.getAttribute("title")).toMatch(/local time/);
  });

  it("formats in UTC regardless of the local zone", () => {
    expect(formatIsoDate("2026-01-01T00:30:00.000+02:00")).toBe("2025-12-31");
  });
});

describe("CopyField", () => {
  it("copies its value and says so", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <CopyField label="Invitation link" value="https://x/#t" copyLabel="Copy link" />,
    );

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith("https://x/#t");
    expect(screen.getByRole("button", { name: "Copied" })).toBeDefined();
    expect((screen.getByLabelText("Invitation link") as HTMLInputElement).readOnly).toBe(
      true,
    );
  });
});
