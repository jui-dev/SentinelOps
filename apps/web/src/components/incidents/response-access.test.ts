import { describe, expect, it } from "vitest";

import { responseAccessLabel } from "./response-access";

const ME = "0199a1b2-c3d4-7000-8000-0000000000aa";
const OTHER = "0199a1b2-c3d4-7000-8000-0000000000bb";
const admin = { decides: true, membershipId: "0199a1b2-c3d4-7000-8000-0000000000ad" };
const member = { decides: false, membershipId: ME };

const assigned = (...ids: string[]) => ({
  responseAccess: "ASSIGNED" as const,
  assignees: ids.map((membershipId) => ({ membershipId, name: membershipId })),
});

describe("responseAccessLabel", () => {
  it("asks the Admin to decide, and tells a member it waits on the Admin", () => {
    const pending = { responseAccess: "PENDING" as const, assignees: [] };

    expect(responseAccessLabel(pending, admin)).toEqual({
      text: "Needs a decision",
      tone: "decision",
    });
    expect(responseAccessLabel(pending, member)).toEqual({
      text: "Waiting for the Admin",
      tone: "waiting",
    });
  });

  it("says the same to everyone when it is open to the team", () => {
    const open = { responseAccess: "OPEN" as const, assignees: [] };

    expect(responseAccessLabel(open, admin).text).toBe("Open to team");
    expect(responseAccessLabel(open, member).text).toBe("Open to team");
  });

  it("tells a member when it is theirs, and otherwise how many are on it", () => {
    expect(responseAccessLabel(assigned(ME, OTHER), member)).toEqual({
      text: "Assigned to you",
      tone: "yours",
    });
    expect(responseAccessLabel(assigned(OTHER), member).text).toBe("Assigned · 1 person");
    expect(responseAccessLabel(assigned(ME, OTHER), admin).text).toBe("Assigned · 2 people");
  });
});
