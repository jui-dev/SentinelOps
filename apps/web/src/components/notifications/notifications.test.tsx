import { QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InfiniteData } from "@tanstack/react-query";
import { StrictMode } from "react";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationResponse, Page } from "@/lib/api/contracts";
import { queryKeys } from "@/lib/api/query-keys";
import { SessionProvider } from "@/lib/auth/session-provider";
import { clearAccessToken } from "@/lib/auth/token-store";
import {
  apiError,
  currentUser,
  jsonResponse,
  mockApi,
  organization,
  organizationDetail,
  refreshed,
  route,
} from "@/test/api";
import type { SentRequest } from "@/test/api";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithSession } from "@/test/render";

import { NOTIFICATION_POLL_MS } from "./notification-queries";
import { NotificationsBell } from "./notifications-bell";

const navigation = vi.hoisted(() => ({
  params: {} as { orgSlug?: string },
  pathname: "/",
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

// A plain link: jsdom cannot navigate, so following one runs its handler
// and goes nowhere.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a
      href={href}
      {...rest}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

const base = `/organizations/${organization.id}/notifications`;
const READ_ALL = [
  "incidents:read",
  "memberships:read",
  "notifications:read",
  "organization:read",
  "teams:read",
];

const idOf = (n: number) =>
  `0199a1b2-c3d4-7000-8000-${String(n).padStart(12, "0")}`;

const incidentRow = (
  n: number,
  readAt: string | null = null,
): NotificationResponse => ({
  id: idOf(n),
  type: "INCIDENT_SEVERITY_CHANGED",
  createdAt: `2026-09-21T10:${String(n).padStart(2, "0")}:00.000Z`,
  readAt,
  actor: { id: idOf(900), name: "Alice Anders" },
  incident: {
    number: 100 + n,
    title: `Incident ${n}`,
    severity: "SEV1",
    status: "INVESTIGATING",
    service: { name: "Payment API", slug: "payment-api" },
  },
  change: { from: "SEV2", to: "SEV1" },
  team: null,
});

const teamRow = (n: number): NotificationResponse => ({
  id: idOf(n),
  type: "TEAM_MEMBERSHIP_ADDED",
  createdAt: `2026-09-21T10:${String(n).padStart(2, "0")}:00.000Z`,
  readAt: null,
  actor: { id: idOf(900), name: "Alice Anders" },
  incident: null,
  change: null,
  team: { id: idOf(800), name: "Payments" },
});

/**
 * The API as these tests need it: a count, a list in pages of two, and
 * acknowledgements that change both, each overridable.
 */
const server = (
  initial: NotificationResponse[] = [],
  {
    permissions = READ_ALL,
    pageSize = 20,
  }: { permissions?: string[]; pageSize?: number } = {},
) => {
  const state = {
    rows: [...initial],
    listFails: false,
    countFails: false,
    markReadFails: false,
    readThroughStatus: 200 as number,
  };
  const unread = () => state.rows.filter(({ readAt }) => readAt === null);
  const readAt = "2026-09-21T12:00:00.000Z";

  const api = mockApi((request: SentRequest) => {
    const key = route(request);

    if (key === "POST /auth/refresh") return refreshed("token");
    if (key === "GET /auth/me") return jsonResponse(200, currentUser);
    if (key === `GET /organizations/${organization.id}`) {
      return jsonResponse(200, organizationDetail(permissions));
    }
    if (key === `GET ${base}/unread-count`) {
      if (state.countFails) return apiError(500);

      return jsonResponse(200, { count: unread().length });
    }
    if (key.startsWith(`GET ${base}`)) {
      if (state.listFails) return apiError(500);

      const after = new URLSearchParams(request.path.split("?")[1]).get(
        "cursor",
      );
      const start = after ? Number(after) : 0;
      const items = state.rows.slice(start, start + pageSize);
      const next = start + pageSize < state.rows.length;

      return jsonResponse(200, {
        items,
        page: { cursor: next ? String(start + pageSize) : null, hasMore: next },
      });
    }
    if (key === `POST ${base}/read`) {
      if (state.readThroughStatus !== 200) {
        return apiError(state.readThroughStatus, "NOTIFICATION_NOT_FOUND");
      }

      const bound = state.rows.findIndex(
        ({ id }) => id === (request.body as { through: string }).through,
      );

      state.rows = state.rows.map((row, index) =>
        index >= bound && row.readAt === null ? { ...row, readAt } : row,
      );

      return jsonResponse(200, { count: unread().length });
    }
    const read = /^POST .*\/notifications\/([^/]+)\/read$/.exec(key);

    if (read) {
      if (state.markReadFails) return apiError(500);

      state.rows = state.rows.map((row) =>
        row.id === read[1] ? { ...row, readAt: row.readAt ?? readAt } : row,
      );

      return jsonResponse(
        200,
        state.rows.find(({ id }) => id === read[1]),
      );
    }

    return apiError(404);
  });

  return { ...api, state };
};

const at = (pathname: string, orgSlug?: string) => {
  navigation.pathname = pathname;
  navigation.params = orgSlug ? { orgSlug } : {};
};

const bell = (name: string | RegExp) =>
  screen.findByRole("button", { name });

/** The bell once it is live: permissions are known and it opens the panel. */
const liveBell = async (name: string | RegExp = /^Notifications/) => {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name }).getAttribute("aria-haspopup"),
    ).toBe("dialog"),
  );

  return screen.getByRole("button", { name });
};

const panel = () => screen.getByRole("dialog", { name: "Notifications" });

const rows = () =>
  within(panel()).queryAllByRole("link");

const notificationRequests = (requests: SentRequest[]) =>
  requests.map(route).filter((key) => key.includes("/notifications"));

describe("the notification bell", () => {
  beforeEach(() => {
    clearAccessToken();
    at("/orgs/acme-ops", "acme-ops");
  });

  it("is disabled, and says why, outside an organization", async () => {
    at("/orgs");
    const { requests } = server();
    const user = userEvent.setup();

    renderWithSession(<NotificationsBell />);

    const button = await bell("Open an organization to see its notifications");

    expect(button.getAttribute("aria-disabled")).toBe("true");
    await user.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(notificationRequests(requests)).toEqual([]);
  });

  it("asks nothing, and opens nothing, without permission to read notifications", async () => {
    const { requests } = server([incidentRow(1)], {
      permissions: ["organization:read"],
    });

    renderWithSession(<NotificationsBell />);

    await waitFor(() =>
      expect(requests.map(route)).toContain(
        `GET /organizations/${organization.id}`,
      ),
    );
    expect(
      (await bell("Notifications")).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(notificationRequests(requests)).toEqual([]);
  });

  it("shows a plain bell when nothing is unread", async () => {
    server([incidentRow(1, "2026-09-21T11:00:00.000Z")]);

    renderWithSession(<NotificationsBell />);

    const button = await liveBell("Notifications");

    await waitFor(() =>
      expect(button.getAttribute("title")).toBe("No unread notifications"),
    );
    expect(button.querySelector("svg")?.getAttribute("class")).not.toMatch(
      /bell-dot/,
    );
  });

  it("changes its shape, not only its colour, when something is unread — and says exactly how many", async () => {
    server([incidentRow(3), incidentRow(2), incidentRow(1)]);

    const { queryClient } = renderWithSession(<NotificationsBell />);

    const button = await bell("Notifications, 3 unread");

    expect(button.getAttribute("title")).toBe("3 unread notifications");
    expect(button.querySelector("svg")?.getAttribute("class")).toMatch(
      /bell-dot/,
    );
    // No number in the strip: only the name and the title carry it.
    expect(button.textContent).toBe("Notifications, 3 unread");
    // It polls the count, every thirty seconds.
    expect(
      queryClient
        .getQueryCache()
        .find({ queryKey: queryKeys.unreadNotificationCount(organization.id) })
        ?.observers.map(({ options }) => options.refetchInterval),
    ).toContain(NOTIFICATION_POLL_MS);
  });

  it("shows no dot, and no error, while the count cannot be read", async () => {
    const api = server([incidentRow(1)]);

    api.state.countFails = true;
    renderWithSession(<NotificationsBell />);

    const button = await liveBell("Notifications");

    await waitFor(() =>
      expect(api.requests.map(route)).toContain(`GET ${base}/unread-count`),
    );
    expect(button.querySelector("svg")?.getAttribute("class")).not.toMatch(
      /bell-dot/,
    );
    expect(button.textContent).toBe("Notifications");
  });
});

describe("the notification panel", () => {
  beforeEach(() => {
    clearAccessToken();
    at("/orgs/acme-ops", "acme-ops");
  });

  const open = async () => {
    const user = userEvent.setup();

    await user.click(await liveBell());

    return user;
  };

  it("opens as a named dialog, asks for the count then the list, and reads nothing", async () => {
    const { requests } = server([
      incidentRow(3),
      teamRow(2),
      incidentRow(1, "2026-09-21T11:00:00.000Z"),
    ]);

    renderWithSession(<NotificationsBell />);

    const button = await liveBell("Notifications, 2 unread");

    requests.length = 0;
    await userEvent.setup().click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(panel().id);
    await waitFor(() => expect(rows()).toHaveLength(3));

    const asked = notificationRequests(requests);

    expect(asked.indexOf(`GET ${base}/unread-count`)).toBeLessThan(
      asked.indexOf(`GET ${base}`),
    );
    expect(asked.some((key) => key.startsWith("POST"))).toBe(false);
    expect(within(panel()).getByText("· 2 unread")).toBeTruthy();
  });

  it("names each row as a sentence, unread first, and links it within the organization", async () => {
    server([
      incidentRow(3),
      teamRow(2),
      incidentRow(1, "2026-09-21T11:00:00.000Z"),
    ]);

    renderWithSession(<NotificationsBell />);
    await open();
    await waitFor(() => expect(rows()).toHaveLength(3));

    const [raised, team, read] = rows();

    expect(raised.getAttribute("aria-label")).toMatch(
      /^Unread\. Severity raised\. INC-103 Incident 3\. SEV2 to SEV1, by Alice Anders\. /,
    );
    expect(raised.getAttribute("href")).toBe("/orgs/acme-ops/incidents/103");
    expect(team.getAttribute("aria-label")).toMatch(
      /^Unread\. Added to a team\. Payments\. By Alice Anders\./,
    );
    expect(team.getAttribute("href")).toBe(`/orgs/acme-ops/teams/${idOf(800)}`);
    expect(read.getAttribute("aria-label")).toMatch(/^Severity raised\./);
    // The time is machine-readable; the local time is on hover.
    const time = raised.querySelector("time");

    expect(time?.getAttribute("dateTime")).toBe("2026-09-21T10:03:00.000Z");
    expect(time?.getAttribute("title")).toBeTruthy();
    // The acknowledgement time is never shown.
    expect(panel().textContent).not.toContain("11:00");
  });

  it("moves focus to the first row, between rows by arrow keys, and back to the bell on Escape", async () => {
    server([incidentRow(3), incidentRow(2), incidentRow(1)]);

    renderWithSession(<NotificationsBell />);

    const user = await open();

    await waitFor(() => expect(document.activeElement).toBe(rows()[0]));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows()[1]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(rows()[2]);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(rows()[1]);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Notifications/ }),
    );
  });

  it("closes when focus leaves it, or on a press elsewhere", async () => {
    server([incidentRow(1)]);

    const { container } = renderWithSession(
      <>
        <NotificationsBell />
        <button type="button">Elsewhere</button>
      </>,
    );

    const user = await open();

    await waitFor(() => expect(rows()).toHaveLength(1));
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(await liveBell());
    expect(panel()).toBeTruthy();
    await user.click(container);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the page changes", async () => {
    server([incidentRow(1)]);

    const { rerender, queryClient } = renderWithSession(<NotificationsBell />);

    await open();
    expect(panel()).toBeTruthy();

    at("/orgs/acme-ops/incidents", "acme-ops");
    rerender(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <NotificationsBell />
          </SessionProvider>
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reads a row as it is followed, at once, and closes", async () => {
    const api = server([incidentRow(2), incidentRow(1)]);

    renderWithSession(<NotificationsBell />);

    const user = await open();

    await waitFor(() => expect(rows()).toHaveLength(2));
    await user.click(rows()[1]);

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(api.requests.map(route)).toContain(
        `POST ${base}/${idOf(1)}/read`,
      ),
    );
    await bell("Notifications, 1 unread");
  });

  it("stays open when a row is opened elsewhere, and tells an own acknowledgement from an arrival", async () => {
    const api = server([incidentRow(3), incidentRow(2)]);

    const { queryClient } = renderWithSession(<NotificationsBell />);

    const user = await open();

    await waitFor(() => expect(rows()).toHaveLength(2));

    // Opened in a new tab: read, and the panel stays.
    await user.keyboard("{Control>}");
    await user.click(rows()[0]);
    await user.keyboard("{/Control}");

    expect(panel()).toBeTruthy();
    await waitFor(() =>
      expect(within(panel()).getByText("· 1 unread")).toBeTruthy(),
    );

    // The count is polled again: it fell by our own doing, nothing arrived.
    await act(() =>
      queryClient.refetchQueries({
        queryKey: queryKeys.unreadNotificationCount(organization.id),
      }),
    );
    expect(within(panel()).queryByText("New notifications · Show")).toBeNull();

    // Something arrives, and the next poll says so — without moving the list.
    api.state.rows = [incidentRow(4), ...api.state.rows];
    await act(() =>
      queryClient.refetchQueries({
        queryKey: queryKeys.unreadNotificationCount(organization.id),
      }),
    );

    const show = await within(panel()).findByRole("button", {
      name: "New notifications · Show",
    });

    expect(rows()).toHaveLength(2);

    await user.click(show);

    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(within(panel()).queryByText("New notifications · Show")).toBeNull();
  });

  it("marks all read up to the newest shown, and leaves an arrival after it unread", async () => {
    const api = server([incidentRow(3), incidentRow(2), incidentRow(1)]);

    renderWithSession(<NotificationsBell />);

    const user = await open();

    await waitFor(() => expect(rows()).toHaveLength(3));

    // Arrives after the list was shown.
    api.state.rows = [incidentRow(4), ...api.state.rows];

    await user.click(
      within(panel()).getByRole("button", { name: "Mark all as read" }),
    );

    await waitFor(() =>
      expect(
        rows().every(
          (row) => !row.getAttribute("aria-label")?.startsWith("Unread"),
        ),
      ).toBe(true),
    );
    expect(
      api.requests.find((request) => route(request) === `POST ${base}/read`)
        ?.body,
    ).toEqual({ through: idOf(3) });
    expect(
      screen.getByRole("status", { hidden: true }).textContent ??
        within(panel()).getAllByRole("status")[0].textContent,
    ).toBeDefined();
    expect(
      within(panel()).getByText("All notifications marked as read."),
    ).toBeTruthy();
    // The arrival is still unread, and offered.
    expect(
      await within(panel()).findByRole("button", {
        name: "New notifications · Show",
      }),
    ).toBeTruthy();
    expect(within(panel()).getByText("· 1 unread")).toBeTruthy();
    expect(
      within(panel()).queryByRole("button", { name: "Mark all as read" }),
    ).toBeNull();
  });

  it("says the list changed when the newest shown has gone, and fetches it again", async () => {
    const api = server([teamRow(2), incidentRow(1)]);

    renderWithSession(<NotificationsBell />);

    const user = await open();

    await waitFor(() => expect(rows()).toHaveLength(2));
    api.state.readThroughStatus = 404;
    api.state.rows = [incidentRow(1)];

    await user.click(
      within(panel()).getByRole("button", { name: "Mark all as read" }),
    );

    expect(
      await within(panel()).findByText("The list changed — try again."),
    ).toBeTruthy();
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it("lets a failed acknowledgement pass quietly, the row unread again", async () => {
    const api = server([incidentRow(2), incidentRow(1)]);

    renderWithSession(<NotificationsBell />);

    const user = await open();

    await waitFor(() => expect(rows()).toHaveLength(2));
    api.state.markReadFails = true;

    await user.keyboard("{Control>}");
    await user.click(rows()[0]);
    await user.keyboard("{/Control}");

    await waitFor(() =>
      expect(
        api.requests.map(route).filter((key) => key === `GET ${base}`).length,
      ).toBeGreaterThan(1),
    );
    await waitFor(() =>
      expect(rows()[0].getAttribute("aria-label")).toMatch(/^Unread/),
    );
    expect(within(panel()).queryByText(/couldn|failed|error/i)).toBeNull();
  });

  it("says when there is nothing yet", async () => {
    server([]);

    renderWithSession(<NotificationsBell />);
    await open();

    expect(await within(panel()).findByText("No notifications yet")).toBeTruthy();
    expect(
      within(panel()).getByText(
        "Incident and team updates that need your attention will appear here.",
      ),
    ).toBeTruthy();
    expect(
      within(panel()).queryByRole("button", { name: "Mark all as read" }),
    ).toBeNull();
  });

  it("offers Retry when the list cannot be read", async () => {
    const api = server([incidentRow(1)]);

    api.state.listFails = true;
    renderWithSession(<NotificationsBell />);

    const user = await open();

    // A server error is retried once before it is shown.
    const retry = await within(panel()).findByRole(
      "button",
      { name: "Retry" },
      { timeout: 4000 },
    );

    api.state.listFails = false;
    await user.click(retry);

    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it("shows older pages, and keeps only the first once closed", async () => {
    server([incidentRow(3), incidentRow(2), incidentRow(1)], { pageSize: 2 });

    const { queryClient } = renderWithSession(<NotificationsBell />);

    const user = await open();

    await waitFor(() => expect(rows()).toHaveLength(2));
    await user.click(within(panel()).getByRole("button", { name: "Show older" }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(
      within(panel()).queryByRole("button", { name: "Show older" }),
    ).toBeNull();
    // Focus moves to the first older row, the button being gone.
    await waitFor(() => expect(document.activeElement).toBe(rows()[2]));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();

    expect(
      queryClient.getQueryData<InfiniteData<Page<NotificationResponse>>>(
        queryKeys.notificationList(organization.id),
      )?.pages,
    ).toHaveLength(1);
  });

  it("has no accessibility violations when open", async () => {
    server([
      incidentRow(3),
      teamRow(2),
      incidentRow(1, "2026-09-21T11:00:00.000Z"),
    ]);

    const { container } = renderWithSession(<NotificationsBell />);

    await open();
    await waitFor(() => expect(rows()).toHaveLength(3));

    await expectNoAxeViolations(container);
  });
});
