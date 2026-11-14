// @vitest-environment happy-dom
/**
 * IMP-135: the "More canvas options" menu shows its commands under five
 * headings, on a computer and on a phone.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/lib/product-surfaces", () => ({
  isArCanvasEnabled: () => true,
}));
vi.mock("@/features/canvas/components/ShareDialog", () => ({
  ShareDialog: () => null,
}));
vi.mock("@/features/canvas/components/MeetingTimer", () => ({
  MeetingTimer: () => null,
}));

import { CanvasHeader } from "@/features/canvas/components/CanvasHeader";

const HEADINGS = ["Canvas", "View", "AI", "Tools", "History"];

function stubPhone(isPhone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isPhone,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function renderHeader() {
  const fn = () => {};
  return render(
    <CanvasHeader
      canvasId="c1"
      canvasName="Plans"
      onCanvasNameChange={fn}
      zoom={1}
      onZoomChange={fn}
      onFitToScreen={fn}
      onExport={fn}
      onVersionHistory={fn}
      onTagFilter={fn}
      gridVisible
      onGridToggle={fn}
      snapEnabled
      onSnapToggle={fn}
      searchQuery=""
      onSearchChange={fn}
      collaborators={[
        { userId: "u2", email: "sam@example.com", name: "Sam", color: "#f00" },
      ]}
      onFollowUser={fn}
      viewMode="manual"
      onViewModeChange={fn}
      onAI={fn}
      onTimeMachine={fn}
      onSerendipity={fn}
      onAutopilot={fn}
      onSortIntoPiles={fn}
      onWhisper={fn}
      onAR={fn}
      onPresentationMode={fn}
      canManageCanvas
    />,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "More canvas options" }));
  return screen.getByRole("menu", { name: "More canvas options" });
}

const COMMON = [
  "Search canvas",
  "Filter canvas by tags",
  "Present",
  "Dark mode",
  "Export canvas",
  "AI assistant",
  "Auto-organise canvas",
  "Sort into piles",
  "Surprise me",
  "Quick capture",
  "Shared timer",
  "Augmented reality view (experimental)",
  "Replay changes",
  "Saved versions",
];

const PHONE_ONLY = [
  "Rename canvas",
  "Switch to Organised list",
  "Zoom in",
  "Zoom out",
  "Hide grid",
  "Turn off snap to grid",
  "Follow Sam",
];

function labelsInOrder(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll("li"))
    .filter((li) => !li.matches('[role="separator"]'))
    .map((li) => li.textContent ?? "");
}

describe.each([
  { name: "computer", phone: false },
  { name: "phone", phone: true },
])("canvas header menu groups on a $name", ({ phone }) => {
  beforeEach(() => stubPhone(phone));
  afterEach(cleanup);

  it("shows the five headings in order", () => {
    renderHeader();
    const menu = openMenu();
    const headings = Array.from(
      menu.querySelectorAll('li[role="presentation"]'),
    ).map((li) => li.textContent);
    expect(headings).toEqual(HEADINGS);
    expect(menu.querySelectorAll('li[role="separator"]')).toHaveLength(4);
  });

  it("keeps Replay changes and Saved versions together under History", () => {
    renderHeader();
    const order = labelsInOrder(openMenu());
    const history = order.indexOf("History");
    expect(order.slice(history)).toEqual([
      "History",
      "Replay changes",
      "Saved versions",
    ]);
  });

  it("lists every command exactly once", () => {
    renderHeader();
    const menu = openMenu();
    const expected = phone ? [...COMMON, ...PHONE_ONLY] : COMMON;
    for (const label of expected) {
      const matches = screen
        .getAllByRole("menuitem")
        .filter((item) => item.textContent === label);
      expect(matches, label).toHaveLength(1);
    }
    expect(menu.textContent).not.toMatch(
      /Visual history|Version history|Time Machine|Auto-organize/,
    );
  });

  it("puts each command under the right heading", () => {
    renderHeader();
    const order = labelsInOrder(openMenu());
    const section = (from: string, to?: string) =>
      order.slice(order.indexOf(from) + 1, to ? order.indexOf(to) : undefined);
    expect(section("AI", "Tools")).toEqual([
      "AI assistant",
      "Auto-organise canvas",
      "Sort into piles",
      "Surprise me",
    ]);
    expect(section("Tools", "History").slice(0, 3)).toEqual([
      "Quick capture",
      "Shared timer",
      "Augmented reality view (experimental)",
    ]);
    expect(section("Canvas", "View").at(-1)).toBe("Export canvas");
  });
});

describe("canvas header menu keyboard", () => {
  beforeEach(() => stubPhone(false));
  afterEach(cleanup);

  it("arrow keys move between commands and skip headings", () => {
    renderHeader();
    const menu = openMenu();
    const items = screen.getAllByRole("menuitem");
    const first = items[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    expect(
      menu.querySelectorAll('li[role="presentation"][tabindex]'),
    ).toHaveLength(0);
  });
});
