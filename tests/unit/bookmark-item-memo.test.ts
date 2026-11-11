import { describe, expect, it, vi } from "vitest";
import { resolveCanvasCapabilities, type CanvasItem } from "@/types/canvas";
import { areBookmarkItemPropsEqual } from "@/features/canvas/components/BookmarkItem";

const item = {
  id: "b1",
  updatedAt: "2026-11-11T00:00:00Z",
  version: 1,
} as unknown as CanvasItem;

function props(
  level: "VIEW" | "EDIT",
  overrides: Record<string, unknown> = {},
) {
  return {
    item,
    isSelected: false,
    capabilities: resolveCanvasCapabilities(level),
    onSelect: vi.fn(),
    onActivate: vi.fn(),
    onContextMenu: vi.fn(),
    onCommitGeometry: vi.fn(),
    ...overrides,
  } as Parameters<typeof areBookmarkItemPropsEqual>[0];
}

describe("BookmarkItem memo comparator", () => {
  it("re-renders when capabilities change (VIEW -> EDIT and back)", () => {
    expect(areBookmarkItemPropsEqual(props("VIEW"), props("EDIT"))).toBe(false);
    expect(areBookmarkItemPropsEqual(props("EDIT"), props("VIEW"))).toBe(false);
  });

  it("still skips when nothing relevant changed, even with fresh callbacks", () => {
    expect(areBookmarkItemPropsEqual(props("EDIT"), props("EDIT"))).toBe(true);
  });

  it("re-renders when one capability flag differs", () => {
    const edit = resolveCanvasCapabilities("EDIT");
    expect(
      areBookmarkItemPropsEqual(
        props("EDIT"),
        props("EDIT", { capabilities: { ...edit, canResizeItems: false } }),
      ),
    ).toBe(false);
  });
});
