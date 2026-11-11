// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";

const mutateAsync = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/hooks/use-canvas-items", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUpdateCanvasItem: () => ({ mutateAsync }),
}));

import { resolveTimeMachineCapabilities } from "@/features/canvas/hooks/use-canvas-data";
import { useItemGeometry } from "@/features/canvas/hooks/use-item-geometry";

describe("Time Machine preview capabilities", () => {
  it("turns every item mutation off while previewing and restores them after", () => {
    const owner = resolveCanvasCapabilities("OWNER");
    const preview = resolveTimeMachineCapabilities(owner, true);
    expect(preview).toMatchObject({
      canMoveItems: false,
      canResizeItems: false,
      canEditItems: false,
      canCreateItems: false,
      canDeleteItems: false,
      canVote: false,
    });
    expect(preview.canCopyItems).toBe(true);
    expect(resolveTimeMachineCapabilities(owner, false)).toBe(owner);
  });

  it("commitGeometry writes nothing for a previewed item", () => {
    const owner = resolveCanvasCapabilities("OWNER");
    const { result } = renderHook(() =>
      useItemGeometry({
        capabilities: resolveTimeMachineCapabilities(owner, true),
      }),
    );
    const item = { id: "i1", type: ItemType.NOTE, version: 1 } as CanvasItem;
    expect(
      result.current.commitGeometry(item, { positionX: 5, positionY: 5 }),
    ).toBe(false);
    expect(
      result.current.commitGeometry(item, {
        positionX: 5,
        positionY: 5,
        width: 9,
        height: 9,
      }),
    ).toBe(false);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
