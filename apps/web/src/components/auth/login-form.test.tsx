import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAccessToken, getAccessToken } from "@/lib/auth/token-store";
import {
  apiError,
  currentUser,
  jsonResponse,
  mockApi,
  route,
} from "@/test/api";
import type { SentRequest } from "@/test/api";
import { renderWithSession } from "@/test/render";

import { env } from "@/lib/config/env";

import { LoginForm } from "./login-form";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

const withLogin = (login: (request: SentRequest) => Response) =>
  mockApi((request) => {
    switch (route(request)) {
      case "POST /auth/refresh":
        return apiError(401, "INVALID_REFRESH_TOKEN");
      case "POST /auth/login":
        return login(request);
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      default:
        return apiError(404);
    }
  });

const submit = async (email: string, password: string) => {
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
};

describe("LoginForm", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.replace.mockReset();
    navigation.search = "";
  });

  it("shows no demo personas outside development", async () => {
    withLogin(() => apiError(401, "INVALID_CREDENTIALS"));
    renderWithSession(<LoginForm />);

    await screen.findByLabelText("Email");

    expect(
      screen.queryByRole("heading", { name: "Try a demo account" }),
    ).toBeNull();
  });

  it("offers no way to create an organization while sign-up is closed", async () => {
    withLogin(() => apiError(401, "INVALID_CREDENTIALS"));
    renderWithSession(<LoginForm />);

    await screen.findByLabelText("Email");

    expect(screen.queryByRole("link", { name: "Create an organization" })).toBeNull();
    expect(
      screen.getByText("Need an account? Ask your organization's Admin to add you."),
    ).toBeDefined();
  });

  it("offers creating an organization while sign-up is open", async () => {
    vi.mocked(env).registrationEnabled = true;
    withLogin(() => apiError(401, "INVALID_CREDENTIALS"));
    renderWithSession(<LoginForm />);

    try {
      expect(
        (
          await screen.findByRole("link", { name: "Create an organization" })
        ).getAttribute("href"),
      ).toBe("/register");
    } finally {
      vi.mocked(env).registrationEnabled = false;
    }
  });

  it("signs in as a demo persona in one click, in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const user = userEvent.setup();
    const { requests } = withLogin(() =>
      jsonResponse(200, {
        accessToken: "token",
        expiresIn: 900,
        tokenType: "Bearer",
        user: currentUser,
      }),
    );

    try {
      renderWithSession(<LoginForm />);

      const roles = await screen.findByRole("region", {
        name: "Try a demo account",
      });

      // In the order an incident needs them, the Admin last.
      expect(
        within(roles)
          .getAllByRole("button", { name: /^Sign in as / })
          .map((button) => button.getAttribute("aria-label")),
      ).toEqual([
        "Sign in as Alex Rivera",
        "Sign in as Ava Kim",
        "Sign in as Priya Shah",
        "Sign in as Sam Okafor",
        "Sign in as Lee Chen",
        "Sign in as Jordan Diaz",
        "Sign in as Dev Admin",
      ]);
      expect(within(roles).getByText("Reporter")).toBeDefined();
      expect(within(roles).getByText("Responders · 4")).toBeDefined();
      // A Responder says which teams they respond for.
      expect(within(roles).getByText("Payments & Risk teams")).toBeDefined();
      expect(
        within(roles).getByRole("region", { name: "Responders" }),
      ).toBeDefined();
      expect(within(roles).getByText("dev-password-123")).toBeDefined();

      await user.click(
        screen.getByRole("button", { name: "Sign in as Sam Okafor" }),
      );

      await waitFor(() =>
        expect(
          requests.find((r) => route(r) === "POST /auth/login")?.body,
        ).toEqual({ email: "sam@example.com", password: "dev-password-123" }),
      );
      await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("says the credentials were wrong without saying which", async () => {
    withLogin(() => apiError(401, "INVALID_CREDENTIALS"));
    renderWithSession(<LoginForm />);

    await submit("ada@example.com", "wrong password");

    expect(
      (await screen.findByRole("alert")).textContent,
    ).toContain("Incorrect email or password.");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("says how long to wait after too many wrong passwords", async () => {
    withLogin(() =>
      apiError(429, "TOO_MANY_ATTEMPTS", {
        message: "Too many attempts. Try again in 15 minutes.",
      }),
    );
    renderWithSession(<LoginForm />);

    await submit("ada@example.com", "another guess");

    expect(
      (await screen.findByRole("alert")).textContent,
    ).toContain("Too many attempts. Try again in 15 minutes.");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("puts validation messages on their fields", async () => {
    withLogin(() =>
      apiError(400, undefined, {
        message: "Request validation failed",
        details: [{ field: "email", message: "Invalid email address" }],
      }),
    );
    renderWithSession(<LoginForm />);

    await submit("not-an-email", "whatever");

    expect(await screen.findByText("Invalid email address")).toBeDefined();
    expect(
      screen.getByLabelText("Email").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("signs in and goes to a safe ?next= path", async () => {
    navigation.search = "next=%2Forgs%2Facme-ops%2Fmembers";
    const { requests } = withLogin(() =>
      jsonResponse(200, {
        accessToken: "issued",
        expiresIn: 900,
        tokenType: "Bearer",
        user: currentUser,
      }),
    );
    renderWithSession(<LoginForm />);

    await submit("ada@example.com", "correct horse battery");

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/orgs/acme-ops/members"),
    );
    expect(getAccessToken()).toBe("issued");

    const login = requests.find((r) => route(r) === "POST /auth/login");

    expect(login).toMatchObject({
      credentials: "include",
      authorization: null,
      body: { email: "ada@example.com", password: "correct horse battery" },
    });
  });

  it("ignores an unsafe ?next= path", async () => {
    navigation.search = "next=%2F%2Fevil.example";
    withLogin(() =>
      jsonResponse(200, {
        accessToken: "issued",
        expiresIn: 900,
        tokenType: "Bearer",
        user: currentUser,
      }),
    );
    renderWithSession(<LoginForm />);

    await submit("ada@example.com", "correct horse battery");

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
  });
});
