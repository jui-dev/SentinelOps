import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeControl } from "@/components/app/theme-control";

import {
  setThemePreference,
  ThemeSync,
  useThemePreference,
} from "./theme";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme-script";

const root = document.documentElement;
const runInitScript = () => new Function(THEME_INIT_SCRIPT)();

beforeEach(() => {
  localStorage.clear();
  root.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pre-paint script", () => {
  it.each(["light", "dark"])("applies a stored %s choice", (theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    runInitScript();

    expect(root.getAttribute("data-theme")).toBe(theme);
  });

  it("leaves the system in charge without a stored choice", () => {
    runInitScript();

    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("ignores a value it does not recognise", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia\" onload=\"x");

    runInitScript();

    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(runInitScript).not.toThrow();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("is a constant, so a Content Security Policy can pin it by hash", () => {
    expect(THEME_INIT_SCRIPT).not.toMatch(/\$\{/);
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });
});

describe("setThemePreference", () => {
  it("stores and applies an explicit choice", () => {
    setThemePreference("dark");

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("hands back to the system", () => {
    setThemePreference("dark");
    setThemePreference("system");

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("still applies the choice when storage refuses it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    setThemePreference("light");

    expect(root.getAttribute("data-theme")).toBe("light");
  });
});

describe("useThemePreference", () => {
  it("reads the stored choice and follows changes", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { result } = renderHook(() => useThemePreference());

    expect(result.current).toBe("light");

    act(() => setThemePreference("dark"));

    expect(result.current).toBe("dark");
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useThemePreference());

    act(() => {
      // Another tab wrote storage; this tab only hears the event.
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }),
      );
    });

    expect(result.current).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });
});

describe("ThemeSync", () => {
  it("re-applies the stored choice after React resets <html>", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    // What Strict Mode's development remount does to the script's attribute.
    root.removeAttribute("data-theme");

    render(<ThemeSync />);

    expect(root.getAttribute("data-theme")).toBe("dark");
  });
});

describe("ThemeControl", () => {
  it("is a named radio group reflecting and changing the choice", async () => {
    const user = userEvent.setup();

    render(<ThemeControl />);

    const group = screen.getByRole("group", { name: "Theme" });

    expect(group).toBeDefined();
    expect(
      (screen.getByRole("radio", { name: "System theme" }) as HTMLInputElement)
        .checked,
    ).toBe(true);

    await user.click(screen.getByRole("radio", { name: "Dark theme" }));

    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(
      (screen.getByRole("radio", { name: "Dark theme" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
