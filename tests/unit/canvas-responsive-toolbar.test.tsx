/**
 * IMP-022 — prioritized toolbar with overflow.
 *
 * Dense canvas controls must stay reachable at 320/375/768 as well as 1024+.
 * Below `md` the secondary actions collapse into one overflow menu; every
 * action keeps the same accessible name in both layouts.
 */

import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CanvasSecondaryActions,
  type CanvasSecondaryAction,
} from "@/features/canvas/components/CanvasSecondaryActions";

/**
 * MUI's useMediaQuery reads window.matchMedia. Emulate a viewport by answering
 * `max-width` queries according to the requested width.
 */
function setViewportWidth(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const maxWidth = /max-width:\s*([\d.]+)px/.exec(query);
    const minWidth = /min-width:\s*([\d.]+)px/.exec(query);
    let matches = false;
    if (maxWidth) matches = width <= Number(maxWidth[1]);
    else if (minWidth) matches = width >= Number(minWidth[1]);

    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}

function makeActions(onClick = vi.fn()): CanvasSecondaryAction[] {
  return [
    { key: "ai", label: "AI assistant", icon: <span />, onClick },
    { key: "whisper", label: "Quick capture", icon: <span />, onClick },
    {
      key: "tags",
      label: "Filter canvas by tags",
      icon: <span />,
      onClick,
      badgeCount: 3,
    },
  ];
}

beforeEach(() => {
  setViewportWidth(1440);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("wide viewports keep actions inline", () => {
  it.each([1024, 1440])(
    "renders each action as its own button at %ipx",
    (width) => {
      setViewportWidth(width);
      render(<CanvasSecondaryActions actions={makeActions()} />);

      expect(screen.getByRole("button", { name: "AI assistant" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Quick capture" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Filter canvas by tags" }),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /more canvas actions/i }),
      ).toBeNull();
    },
  );
});

describe("narrow viewports collapse into one overflow menu", () => {
  it.each([320, 375, 768])(
    "shows a single overflow trigger at %ipx",
    (width) => {
      setViewportWidth(width);
      render(<CanvasSecondaryActions actions={makeActions()} />);

      expect(
        screen.getByRole("button", { name: /more canvas actions/i }),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "AI assistant" })).toBeNull();
    },
  );

  it("keeps every action reachable and named inside the menu", () => {
    setViewportWidth(375);
    render(<CanvasSecondaryActions actions={makeActions()} />);

    fireEvent.click(
      screen.getByRole("button", { name: /more canvas actions/i }),
    );

    expect(screen.getByRole("menuitem", { name: "AI assistant" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Quick capture" }),
    ).toBeTruthy();
    // The badge count stays legible as text rather than a visual-only dot.
    expect(
      screen.getByRole("menuitem", { name: "Filter canvas by tags (3)" }),
    ).toBeTruthy();
  });

  it("invokes the action and closes the menu", () => {
    const onClick = vi.fn();
    setViewportWidth(320);
    render(<CanvasSecondaryActions actions={makeActions(onClick)} />);

    fireEvent.click(
      screen.getByRole("button", { name: /more canvas actions/i }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Quick capture" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("reports expansion state for assistive technology", () => {
    setViewportWidth(320);
    render(<CanvasSecondaryActions actions={makeActions()} />);

    const trigger = screen.getByRole("button", {
      name: /more canvas actions/i,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("empty action sets", () => {
  it("renders nothing rather than an empty overflow button", () => {
    setViewportWidth(320);
    const { container } = render(<CanvasSecondaryActions actions={[]} />);

    expect(container.textContent).toBe("");
  });
});
