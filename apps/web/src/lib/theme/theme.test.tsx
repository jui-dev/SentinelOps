import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppearanceMenu } from "@/components/app/shell-utilities";

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
  it.each(["dark", "light", "system"])("applies a stored %s choice", (theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    runInitScript();

    expect(root.getAttribute("data-theme")).toBe(theme);
  });

  it("leaves the stylesheet's dark default without a stored choice", () => {
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

  it("stores a choice of the system, which is not the default", () => {
    setThemePreference("light");
    setThemePreference("system");

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(root.getAttribute("data-theme")).toBe("system");
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
  it("is dark for someone who has never chosen", () => {
    const { result } = renderHook(() => useThemePreference());

    expect(result.current).toBe("dark");
  });

  it("keeps an earlier explicit choice", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");

    expect(renderHook(() => useThemePreference()).result.current).toBe("light");
  });

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

describe("AppearanceMenu", () => {
  it("names the current appearance and offers the three as a radio menu", async () => {
    const user = userEvent.setup();

    render(<AppearanceMenu />);

    const trigger = screen.getByRole("button", { name: "Appearance: Dark" });

    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(trigger);

    const menu = screen.getByRole("menu", { name: "Appearance" });
    const radios = within(menu).getAllByRole("menuitemradio");

    expect(radios.map((radio) => radio.textContent)).toEqual([
      "Dark",
      "Light",
      "System",
    ]);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // Focus lands on the current choice.
    expect(document.activeElement).toBe(
      within(menu).getByRole("menuitemradio", { name: "Dark", checked: true }),
    );

    await user.click(within(menu).getByRole("menuitemradio", { name: "Light" }));

    expect(root.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Appearance: Light" }),
    );
  });

  it("is worked from the keyboard, and Escape puts focus back", async () => {
    const user = userEvent.setup();

    render(<AppearanceMenu />);

    screen.getByRole("button", { name: "Appearance: Dark" }).focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("menu", { name: "Appearance" })).toBeDefined();

    await user.keyboard("{ArrowDown}{ArrowDown}");

    expect(document.activeElement?.textContent).toBe("System");

    await user.keyboard("{ArrowDown}");

    expect(document.activeElement?.textContent).toBe("Dark");

    await user.keyboard("{End}{Enter}");

    expect(root.getAttribute("data-theme")).toBe("system");

    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Appearance: System" }),
    );
  });

  it("closes on a press elsewhere", async () => {
    const user = userEvent.setup();

    render(
      <>
        <AppearanceMenu />
        <p>Elsewhere</p>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Appearance: Dark" }));
    await user.click(screen.getByText("Elsewhere"));

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
