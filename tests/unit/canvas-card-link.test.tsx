// @vitest-environment happy-dom
/**
 * IMP-090: canvas cards are real links, so new-tab clicks and the link menu
 * work; while selecting they are toggles instead. Icon buttons get a touch
 * sized hit area.
 */
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasCard } from "@/features/dashboard/components/CanvasCard";
import { theme, TOUCH_TARGET } from "@/lib/theme";

afterEach(cleanup);

describe("canvas card", () => {
  it("is one link to the canvas", () => {
    render(<CanvasCard name="Trip" href="/canvas/abc" />);
    const link = screen.getByRole("link", { name: /Trip/ });
    expect(link.getAttribute("href")).toBe("/canvas/abc");
    expect(screen.queryAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is a toggle without an address", () => {
    const onClick = vi.fn();
    render(<CanvasCard name="Trip" selected onClick={onClick} />);
    expect(screen.queryByRole("link")).toBeNull();
    const toggle = screen.getByRole("button", { name: /Trip/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("touch targets", () => {
  it.each(["MuiIconButton", "MuiCheckbox"] as const)(
    "%s is at least 44px on touch screens",
    (name) => {
      const root = (
        theme.components?.[name]?.styleOverrides as {
          root: Record<string, { minWidth: number; minHeight: number }>;
        }
      ).root;
      expect(TOUCH_TARGET).toBeGreaterThanOrEqual(44);
      expect(root["@media (pointer: coarse)"]).toEqual({
        minWidth: TOUCH_TARGET,
        minHeight: TOUCH_TARGET,
      });
    },
  );
});
