// @vitest-environment happy-dom
/**
 * IMP-009 — SSR, theme, shortcut, and error baseline.
 *
 * Covers the three acceptance criteria: server HTML is meaningful without
 * JavaScript, editable surfaces keep their keystrokes, and error UI makes no
 * unearned durability claim.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeModeProvider, useThemeMode } from "@/lib/theme-context";
import {
  DEFAULT_THEME_MODE,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  resolvePreferredThemeMode,
} from "@/lib/theme-preference";
import {
  hasActiveDialog,
  isEditableEventTarget,
  shouldIgnoreGlobalShortcut,
} from "@/lib/keyboard/shortcuts";
import { useKeyboardShortcuts } from "@/lib/hooks/use-keyboard-shortcuts";
import AppError from "@/app/error";
import GlobalError from "@/app/global-error";

function setSystemPrefersDark(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: prefersDark && query.includes("dark"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  setSystemPrefersDark(false);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("server rendering without JavaScript", () => {
  it("renders provider children in server HTML instead of withholding the tree", () => {
    const html = renderToStaticMarkup(
      <ThemeModeProvider>
        <main>
          <h1>Organize your ideas</h1>
        </main>
      </ThemeModeProvider>,
    );

    expect(html).toContain("<h1>Organize your ideas</h1>");
  });

  it("uses a deterministic server mode so hydration starts from known state", () => {
    function ModeProbe() {
      return <span data-testid="mode">{useThemeMode().mode}</span>;
    }

    const html = renderToStaticMarkup(
      <ThemeModeProvider>
        <ModeProbe />
      </ThemeModeProvider>,
    );

    expect(html).toContain(`>${DEFAULT_THEME_MODE}<`);
  });
});

describe("theme reconciliation", () => {
  it("prefers the stored choice over the system preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    setSystemPrefersDark(false);

    expect(resolvePreferredThemeMode()).toBe("dark");
  });

  it("falls back to the system preference when nothing is stored", () => {
    setSystemPrefersDark(true);

    expect(resolvePreferredThemeMode()).toBe("dark");
  });

  it("applies the stored mode to the document before paint", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    function ModeProbe() {
      return <span data-testid="mode">{useThemeMode().mode}</span>;
    }

    render(
      <ThemeModeProvider>
        <ModeProbe />
      </ThemeModeProvider>,
    );

    expect(screen.getByTestId("mode").textContent).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("ships an init script that cannot throw on blocked storage", () => {
    const storageThrows = () => {
      throw new Error("storage blocked");
    };

    expect(() =>
      new Function("localStorage", "window", "document", THEME_INIT_SCRIPT)(
        { getItem: storageThrows },
        { matchMedia: () => ({ matches: false }) },
        { documentElement: { setAttribute: () => {}, style: {} } },
      ),
    ).not.toThrow();
  });
});

describe("global shortcuts ignore editable surfaces", () => {
  it.each([
    ["input", () => document.createElement("input")],
    ["textarea", () => document.createElement("textarea")],
    ["select", () => document.createElement("select")],
  ])("treats a %s as editable", (_name, create) => {
    const element = create();
    document.body.appendChild(element);

    expect(isEditableEventTarget({ target: element })).toBe(true);
  });

  it("treats nested nodes inside a rich-text editor as editable", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const paragraph = document.createElement("p");
    editor.appendChild(paragraph);
    document.body.appendChild(editor);

    expect(isEditableEventTarget({ target: paragraph })).toBe(true);
  });

  it("treats a non-editable element as not editable", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);

    expect(isEditableEventTarget({ target: element })).toBe(false);
  });

  it("detects an open dialog and suppresses global shortcuts inside it", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    expect(hasActiveDialog()).toBe(true);
    expect(shouldIgnoreGlobalShortcut({ target: dialog })).toBe(true);
  });

  it('does not fire "?" while typing in a text field, but does elsewhere', () => {
    const handler = vi.fn();

    function Harness() {
      useKeyboardShortcuts([{ key: "?", handler }]);
      return <input data-testid="field" />;
    }

    render(<Harness />);
    const field = screen.getByTestId("field");

    const typed = new KeyboardEvent("keydown", {
      key: "?",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(typed, "target", { value: field });
    window.dispatchEvent(typed);

    expect(handler).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "?",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("still fires shortcuts that explicitly opt in to editable surfaces", () => {
    const handler = vi.fn();

    function Harness() {
      useKeyboardShortcuts([
        { key: "s", ctrlKey: true, allowInEditable: true, handler },
      ]);
      return <input data-testid="field" />;
    }

    render(<Harness />);
    const field = screen.getByTestId("field");

    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: field });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("error UI durability claims", () => {
  it("does not promise that work was saved", () => {
    render(<AppError error={new Error("boom")} reset={() => {}} />);

    expect(document.body.textContent).not.toMatch(/your work has been saved/i);
    expect(document.body.textContent).toMatch(/may not have been stored/i);
  });

  it("renders a self-contained global error document", () => {
    const html = renderToStaticMarkup(
      <GlobalError
        error={Object.assign(new Error("boom"), { digest: "abc123" })}
        reset={() => {}}
      />,
    );

    expect(html).toContain("Memoria could not load");
    expect(html).toContain("abc123");
    expect(html).not.toMatch(/has been saved/i);
  });
});
