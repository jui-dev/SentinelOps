import { describe, expect, it } from "vitest";

import type { NotificationResponse } from "@/lib/api/contracts";

import {
  describeNotification,
  formatSince,
  speakSince,
} from "./describe-notification";

const SLUG = "acme-ops";
const TEAM_ID = "0199a1b2-c3d4-7000-8000-0000000000c1";

const incidentNotification = (
  overrides: Partial<NotificationResponse> = {},
): NotificationResponse => ({
  id: "0199a1b2-c3d4-7000-8000-0000000000e1",
  type: "INCIDENT_DECLARED",
  createdAt: "2026-09-21T10:00:00.000Z",
  readAt: null,
  actor: { id: "0199a1b2-c3d4-7000-8000-000000000001", name: "Alice Anders" },
  incident: {
    number: 104,
    title: "Login failures",
    severity: "SEV1",
    status: "INVESTIGATING",
    service: { name: "Authentication", slug: "authentication" },
  },
  change: null,
  team: null,
  ...overrides,
});

const teamNotification = (
  type: "TEAM_MEMBERSHIP_ADDED" | "TEAM_MEMBERSHIP_REMOVED",
): NotificationResponse => ({
  id: "0199a1b2-c3d4-7000-8000-0000000000e2",
  type,
  createdAt: "2026-09-21T10:00:00.000Z",
  readAt: null,
  actor: { id: "0199a1b2-c3d4-7000-8000-000000000001", name: "Alice Anders" },
  incident: null,
  change: null,
  team: { id: TEAM_ID, name: "Payments" },
});

describe("describeNotification", () => {
  it("should say an incident was declared, on which service, at what severity, and by whom", () => {
    const description = describeNotification(
      incidentNotification({ change: { from: null, to: "SEV2" } }),
      SLUG,
    );

    expect(description).toEqual({
      icon: "declared",
      headline: "Incident declared",
      subject: {
        kind: "incident",
        key: "INC-104",
        title: "Login failures",
        severity: "SEV1",
        nowResolved: false,
      },
      detail: ["Authentication", "declared as SEV2", "Alice Anders"],
      spoken:
        "Incident declared. INC-104 Login failures. Authentication, declared as SEV2, by Alice Anders.",
      href: "/orgs/acme-ops/incidents/104",
    });
  });

  it("should say which teams an incident moved between, by their names as recorded", () => {
    const description = describeNotification(
      incidentNotification({
        type: "INCIDENT_REASSIGNED",
        change: { from: "Payments", to: "Platform" },
      }),
      SLUG,
    );

    expect(description.icon).toBe("reassigned");
    expect(description.headline).toBe("Incident reassigned");
    expect(description.detail).toEqual(["Payments → Platform", "Alice Anders"]);
    expect(description.spoken).toBe(
      "Incident reassigned. INC-104 Login failures. Payments to Platform, by Alice Anders.",
    );
  });

  it.each([
    ["SEV2", "SEV1", "raised", "Severity raised"],
    ["SEV4", "SEV2", "raised", "Severity raised"],
    ["SEV1", "SEV3", "lowered", "Severity lowered"],
    // A level this client does not know cannot be ranked.
    ["SEV2", "SEV0", "severity", "Severity changed"],
  ])(
    "should say a severity moving %s → %s was %s",
    (from, to, icon, headline) => {
      const description = describeNotification(
        incidentNotification({
          type: "INCIDENT_SEVERITY_CHANGED",
          change: { from, to },
        }),
        SLUG,
      );

      expect(description.icon).toBe(icon);
      expect(description.headline).toBe(headline);
      expect(description.detail).toEqual([`${from} → ${to}`, "Alice Anders"]);
    },
  );

  it("should say an incident was resolved, with its service, and no note", () => {
    const description = describeNotification(
      incidentNotification({
        type: "INCIDENT_RESOLVED",
        incident: {
          number: 97,
          title: "Fraud rules stale",
          severity: "SEV3",
          status: "RESOLVED",
          service: { name: "Fraud Detection", slug: "fraud-detection" },
        },
      }),
      SLUG,
    );

    expect(description.icon).toBe("resolved");
    expect(description.headline).toBe("Incident resolved");
    expect(description.detail).toEqual(["Fraud Detection", "Alice Anders"]);
    // Its own resolution is not "since".
    expect(description.subject).toEqual(
      expect.objectContaining({ nowResolved: false }),
    );
  });

  it("should say an incident is ready to resolve, naming who completed the last response", () => {
    const description = describeNotification(
      incidentNotification({
        type: "INCIDENT_READY_TO_RESOLVE",
        actor: { id: "0199a1b2-c3d4-7000-8000-000000000002", name: "Ben Brandt" },
      }),
      SLUG,
    );

    expect(description.icon).toBe("ready");
    expect(description.headline).toBe("Ready to resolve");
    expect(description.detail).toEqual([
      "All responses complete",
      "last by Ben Brandt",
    ]);
    expect(description.spoken).toBe(
      "Ready to resolve. INC-104 Login failures. All responses complete, the last by Ben Brandt.",
    );
  });

  it.each([
    [
      "INCIDENT_OPENED_TO_TEAM",
      "opened",
      "Open to your team",
      "Open to your team. INC-104 Login failures. You can start responding, opened by Alice Anders.",
    ],
    [
      "INCIDENT_ASSIGNED",
      "assigned",
      "Assigned to you",
      "Assigned to you. INC-104 Login failures. You can start responding, assigned by Alice Anders.",
    ],
  ] as const)(
    "should tell a member of %s that they can now start, and who decided",
    (type, icon, headline, spoken) => {
      const description = describeNotification(
        incidentNotification({ type, change: null }),
        SLUG,
      );

      expect(description.icon).toBe(icon);
      expect(description.headline).toBe(headline);
      expect(description.detail).toEqual(["You can start responding", "Alice Anders"]);
      expect(description.spoken).toBe(spoken);
      expect(description.href).toBe("/orgs/acme-ops/incidents/104");
    },
  );

  it("should tell a reporter their suggested severity was kept", () => {
    const description = describeNotification(
      incidentNotification({
        type: "INCIDENT_SEVERITY_CONFIRMED",
        change: { from: "SEV3", to: "SEV3" },
      }),
      SLUG,
    );

    expect(description.headline).toBe("Severity confirmed");
    expect(description.detail).toEqual(["Kept at SEV3", "Alice Anders"]);
  });

  it("should tell a reporter their suggested severity was settled at another", () => {
    const description = describeNotification(
      incidentNotification({
        type: "INCIDENT_SEVERITY_CONFIRMED",
        change: { from: "SEV3", to: "SEV2" },
      }),
      SLUG,
    );

    expect(description.detail).toEqual(["SEV3 → SEV2", "Alice Anders"]);
    expect(description.spoken).toContain("SEV3 to SEV2, by Alice Anders.");
  });

  it("should mark an incident resolved since, on every notification but its resolution", () => {
    const resolved = {
      number: 104,
      title: "Login failures",
      severity: "SEV1" as const,
      status: "RESOLVED" as const,
      service: { name: "Authentication", slug: "authentication" },
    };

    for (const type of [
      "INCIDENT_DECLARED",
      "INCIDENT_REASSIGNED",
      "INCIDENT_SEVERITY_CHANGED",
      "INCIDENT_READY_TO_RESOLVE",
      "INCIDENT_OPENED_TO_TEAM",
      "INCIDENT_ASSIGNED",
    ] as const) {
      const description = describeNotification(
        incidentNotification({ type, incident: resolved }),
        SLUG,
      );

      expect(description.subject).toEqual(
        expect.objectContaining({ nowResolved: true }),
      );
      expect(description.spoken).toContain("INC-104 Login failures, now resolved.");
    }
  });

  it.each([
    ["TEAM_MEMBERSHIP_ADDED", "team-added", "Added to a team"],
    ["TEAM_MEMBERSHIP_REMOVED", "team-removed", "Removed from a team"],
  ] as const)(
    "should say %s, naming the team as it is now, and link to the team",
    (type, icon, headline) => {
      expect(describeNotification(teamNotification(type), SLUG)).toEqual({
        icon,
        headline,
        subject: { kind: "team", name: "Payments" },
        detail: ["Alice Anders"],
        spoken: `${headline}. Payments. By Alice Anders.`,
        href: `/orgs/acme-ops/teams/${TEAM_ID}`,
      });
    },
  );

  it("should link only within the organization the page is in", () => {
    expect(
      describeNotification(incidentNotification(), "globex").href,
    ).toBe("/orgs/globex/incidents/104");
  });
});

describe("formatSince", () => {
  const NOW = new Date("2026-09-21T12:00:00.000Z");
  const ago = (milliseconds: number) =>
    new Date(NOW.getTime() - milliseconds).toISOString();

  it.each([
    [30_000, "now", "just now"],
    [60_000, "1m", "1 minute ago"],
    [18 * 60_000, "18m", "18 minutes ago"],
    [60 * 60_000, "1h", "1 hour ago"],
    [23 * 60 * 60_000 + 59 * 60_000, "23h", "23 hours ago"],
    [24 * 60 * 60_000, "1d", "1 day ago"],
    [6 * 24 * 60 * 60_000, "6d", "6 days ago"],
  ])("should say %ims ago as %s", (milliseconds, short, spoken) => {
    expect(formatSince(ago(milliseconds), NOW)).toBe(short);
    expect(speakSince(ago(milliseconds), NOW)).toBe(spoken);
  });

  it("should give the date after a week, with the year only when it is another", () => {
    expect(formatSince("2026-09-10T08:00:00.000Z", NOW)).toBe("Sep 10");
    expect(speakSince("2026-09-10T08:00:00.000Z", NOW)).toBe("on Sep 10");
    expect(formatSince("2025-12-30T08:00:00.000Z", NOW)).toBe("Dec 30, 2025");
  });

  it("should read a time slightly ahead of the clock as just now", () => {
    expect(formatSince("2026-09-21T12:00:05.000Z", NOW)).toBe("now");
  });
});
