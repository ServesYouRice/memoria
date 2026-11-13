// @vitest-environment happy-dom
/** IMP-085: a note's menu offers its colours to people who can edit. */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));

import { CanvasContextMenu } from "@/features/canvas/components/CanvasContextMenu";
import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";

const note = {
  id: "note-1",
  canvasId: "cjld2cjxh0000qzrmn831i7rn",
  type: ItemType.NOTE,
  positionX: 0,
  positionY: 0,
  width: 200,
  height: 150,
  content: { text: "hi", color: "blue" },
  version: 1,
} as unknown as CanvasItem;

function renderMenu(
  item: CanvasItem,
  role: "OWNER" | "VIEW",
  onNoteColor = vi.fn(),
) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CanvasContextMenu
        position={{ x: 10, y: 10, itemId: item.id }}
        capabilities={resolveCanvasCapabilities(role)}
        onClose={() => {}}
        onDelete={() => {}}
        onDuplicate={() => {}}
        onCopy={() => {}}
        onComments={() => {}}
        item={item}
        onNoteColor={onNoteColor}
      />
    </QueryClientProvider>,
  );
  return onNoteColor;
}

afterEach(cleanup);

describe("note colour menu", () => {
  it("shows six colours with the current one pressed, and picks one", () => {
    const onNoteColor = renderMenu(note, "OWNER");
    const group = screen.getByRole("group", { name: "Note colour" });
    const swatches = Array.from(group.querySelectorAll("button"));
    expect(swatches.map((swatch) => swatch.getAttribute("aria-label"))).toEqual(
      ["Yellow", "Pink", "Blue", "Green", "Purple", "Orange"],
    );
    expect(
      screen.getByRole("button", { name: "Blue" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Pink" }));
    expect(onNoteColor).toHaveBeenCalledWith("pink");
  });

  it("is not offered to viewers or on other items", () => {
    renderMenu(note, "VIEW");
    expect(screen.queryByRole("group", { name: "Note colour" })).toBeNull();
    cleanup();
    renderMenu({ ...note, type: ItemType.SHAPE } as CanvasItem, "OWNER");
    expect(screen.queryByRole("group", { name: "Note colour" })).toBeNull();
  });
});
