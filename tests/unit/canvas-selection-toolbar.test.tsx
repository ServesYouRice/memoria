// @vitest-environment happy-dom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSelectionToolbar } from "@/features/canvas/components/CanvasSelectionToolbar";
import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";

vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));

const openSavedLink = vi.fn();
vi.mock("@/lib/bookmarks/open-link", () => ({
  openableUrl: (value: unknown) =>
    typeof value === "string" && value.startsWith("https://") ? value : null,
  openSavedLink: (...args: unknown[]) => openSavedLink(...args),
}));

function makeItem(overrides: Partial<CanvasItem>): CanvasItem {
  return {
    id: "item-1",
    canvasId: "canvas-1",
    type: ItemType.NOTE,
    positionX: 200,
    positionY: 200,
    width: 240,
    height: 160,
    zIndex: 1,
    content: { text: "Hello", color: "yellow" },
    tags: [],
    version: 1,
    deletedAt: null,
    createdById: "user-1",
    updatedById: null,
    deletedById: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as CanvasItem;
}

afterEach(() => {
  cleanup();
  openSavedLink.mockReset();
});

describe("CanvasSelectionToolbar", () => {
  it("shows quick note colours and edit actions for an editor", () => {
    const onNoteColor = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <CanvasSelectionToolbar
        item={makeItem({})}
        capabilities={resolveCanvasCapabilities("EDIT")}
        zoom={1}
        position={{ x: 0, y: 0 }}
        stageSize={{ width: 1200, height: 800 }}
        onEdit={onEdit}
        onDuplicate={vi.fn()}
        onComments={vi.fn()}
        onDelete={onDelete}
        onMore={vi.fn()}
        onNoteColor={onNoteColor}
      />,
    );

    expect(
      screen.getByRole("toolbar", { name: "Selected item actions" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Set note colour to Blue" }),
    );
    expect(onNoteColor).toHaveBeenCalledWith("blue");

    fireEvent.click(screen.getByRole("button", { name: "Edit item" }));
    expect(onEdit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("hides editing controls for read-only viewers and hides entirely when off-screen", () => {
    const { container } = render(
      <CanvasSelectionToolbar
        item={makeItem({})}
        capabilities={resolveCanvasCapabilities("VIEW")}
        zoom={1}
        position={{ x: 0, y: 0 }}
        stageSize={{ width: 1200, height: 800 }}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onComments={vi.fn()}
        onDelete={vi.fn()}
        onMore={vi.fn()}
        onNoteColor={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Edit item" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete item" })).toBeNull();
    expect(container.firstChild).toBeNull();

    cleanup();

    const offscreen = render(
      <CanvasSelectionToolbar
        item={makeItem({ positionX: -900, positionY: -900 })}
        capabilities={resolveCanvasCapabilities("OWNER")}
        zoom={1}
        position={{ x: 0, y: 0 }}
        stageSize={{ width: 1200, height: 800 }}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onComments={vi.fn()}
        onDelete={vi.fn()}
        onMore={vi.fn()}
        onNoteColor={vi.fn()}
      />,
    );
    expect(offscreen.container.firstChild).toBeNull();
  });

  it("offers direct link opening for bookmark cards", () => {
    render(
      <CanvasSelectionToolbar
        item={makeItem({
          type: ItemType.BOOKMARK,
          content: { url: "https://example.com/guide", title: "Guide" },
        })}
        capabilities={resolveCanvasCapabilities("VIEW")}
        zoom={1}
        position={{ x: 0, y: 0 }}
        stageSize={{ width: 1200, height: 800 }}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onComments={vi.fn()}
        onDelete={vi.fn()}
        onMore={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open link" }));
    expect(openSavedLink).toHaveBeenCalledWith({
      id: "item-1",
      url: "https://example.com/guide",
    });
  });
});
