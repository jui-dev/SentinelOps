import { act, renderHook, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/api/query-keys";
import { clearAccessToken, setAccessToken } from "@/lib/auth/token-store";
import { createQueryClient } from "@/lib/query/query-client";
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
import { renderWithSession } from "@/test/render";

import { OrganizationScope } from "./organization-scope";
import {
  RenameOrganizationForm,
  useRenameOrganization,
} from "./rename-organization-form";

const navigation = vi.hoisted(() => ({ slug: "acme-ops" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: navigation.slug }),
  usePathname: () => `/orgs/${navigation.slug}/settings`,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const FULL = ["memberships:read", "organization:read", "organization:update"];
const READ = ["memberships:read", "organization:read"];

const signedInApi = (
  organizationResponse: (request: SentRequest) => Response,
) =>
  mockApi((request) => {
    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      default:
        return request.path.startsWith(`/organizations/${organization.id}`)
          ? organizationResponse(request)
          : apiError(404, "ORGANIZATION_NOT_FOUND");
    }
  });

const renderSettings = () =>
  renderWithSession(
    <OrganizationScope>
      <RenameOrganizationForm />
    </OrganizationScope>,
  );

describe("OrganizationScope", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.slug = "acme-ops";
  });

  it("shows not-found for a slug outside the caller's memberships, without asking the API", async () => {
    navigation.slug = "someone-elses";
    const { requests } = signedInApi(() => jsonResponse(200, {}));

    renderSettings();

    expect(await screen.findByText("Organization not found")).toBeDefined();
    expect(
      requests.filter((r) => r.path.startsWith("/organizations")),
    ).toEqual([]);
  });

  it("shows not-found for a malformed slug", async () => {
    navigation.slug = "%E0%A4%A";
    signedInApi(() => jsonResponse(200, {}));

    renderSettings();

    expect(await screen.findByText("Organization not found")).toBeDefined();
  });

  it("resolves the slug to the organization id for API requests", async () => {
    const { requests } = signedInApi(() =>
      jsonResponse(200, organizationDetail(FULL)),
    );

    renderSettings();

    expect(await screen.findByRole("heading", { name: organization.name }))
      .toBeDefined();
    expect(
      requests.find((r) => r.path === `/organizations/${organization.id}`),
    ).toMatchObject({
      method: "GET",
      credentials: "omit",
      authorization: "Bearer token",
    });
  });

  it("shows not-found and refreshes `me` when the API no longer admits the caller", async () => {
    const { requests } = signedInApi(() =>
      apiError(404, "ORGANIZATION_NOT_FOUND"),
    );

    renderSettings();

    expect(await screen.findByText("Organization not found")).toBeDefined();
    await vi.waitFor(() =>
      expect(
        requests.filter((r) => route(r) === "GET /auth/me").length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  describe("settings", () => {
    it("offers the rename form and Settings tab when the API reports organization:update", async () => {
      signedInApi(() => jsonResponse(200, organizationDetail(FULL)));

      renderSettings();

      expect(await screen.findByLabelText("Name")).toBeDefined();
      expect(screen.getByRole("link", { name: "Settings" })).toBeDefined();
    });

    it("hides both when the API does not report organization:update", async () => {
      signedInApi(() =>
        jsonResponse(200, organizationDetail(READ, "MEMBER")),
      );

      renderSettings();

      expect(
        await screen.findByText(/do not have permission to change/),
      ).toBeDefined();
      expect(screen.queryByLabelText("Name")).toBeNull();
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    });

    it("decides by the reported permissions, not by the role name", async () => {
      // A role the client has never heard of, granted the permission.
      signedInApi(() =>
        jsonResponse(200, organizationDetail(FULL, "RESPONDER")),
      );

      renderSettings();

      expect(await screen.findByLabelText("Name")).toBeDefined();
    });
  });
});

describe("useRenameOrganization", () => {
  beforeEach(() => {
    setAccessToken("token");
  });

  it("updates the organization, invalidates only `me`, and leaves memberships alone", async () => {
    const queryClient = createQueryClient();
    const detail = organizationDetail(FULL);

    queryClient.setQueryData(queryKeys.me, currentUser);
    queryClient.setQueryData(queryKeys.organization(organization.id), detail);
    queryClient.setQueryData(queryKeys.memberships(organization.id), []);

    const { requests } = mockApi(() =>
      jsonResponse(200, { ...organization, name: "Renamed Operations" }),
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useRenameOrganization(organization.id),
      { wrapper },
    );

    await act(() => result.current.mutateAsync("Renamed Operations"));

    expect(requests).toEqual([
      expect.objectContaining({
        method: "PATCH",
        path: `/organizations/${organization.id}`,
        body: { name: "Renamed Operations" },
      }),
    ]);
    expect(
      queryClient.getQueryData(queryKeys.organization(organization.id)),
    ).toEqual({ ...detail, name: "Renamed Operations" });

    const state = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated;

    expect(state(queryKeys.me)).toBe(true);
    expect(state(queryKeys.organization(organization.id))).toBe(false);
    expect(state(queryKeys.memberships(organization.id))).toBe(false);
  });

  it("changes no cache when the API refuses", async () => {
    const queryClient = createQueryClient();
    const detail = organizationDetail(READ, "MEMBER");

    queryClient.setQueryData(queryKeys.me, currentUser);
    queryClient.setQueryData(queryKeys.organization(organization.id), detail);
    mockApi(() => apiError(403, "PERMISSION_DENIED"));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useRenameOrganization(organization.id),
      { wrapper },
    );

    await act(async () => {
      await expect(result.current.mutateAsync("Nope")).rejects.toMatchObject({
        statusCode: 403,
        code: "PERMISSION_DENIED",
      });
    });

    expect(
      queryClient.getQueryData(queryKeys.organization(organization.id)),
    ).toEqual(detail);
    expect(queryClient.getQueryState(queryKeys.me)?.isInvalidated).toBe(false);
  });
});
