// @vitest-environment happy-dom
/**
 * IMP-008 — one geometry and capability contract.
 *
 * Parameterized over every item type and every role: one gesture must cause
 * exactly one durable geometry write, unsupported roles must not be able to
 * create a local optimistic mutation, and every supported type must either
 * persist or be explicitly non-resizable.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ItemType,
  RESIZABLE_ITEM_TYPES,
  isItemResizable,
  resolveCanvasCapabilities,
  type CanvasAccessLevel,
  type CanvasItem,
} from "@/types/canvas";
import { commitGroupDragEnd } from "@/features/canvas/lib/geometry-adapter";
import { useItemGeometry } from "@/features/canvas/hooks/use-item-geometry";

const mutateAsync = vi.fn();

vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useUpdateCanvasItem: () => ({ mutateAsync }),
}));

const ALL_ITEM_TYPES = Object.values(ItemType);
const ALL_ROLES: CanvasAccessLevel[] = ["OWNER", "EDIT", "COMMENT", "VIEW"];

function makeItem(type: ItemType): CanvasItem {
  return {
    id: `item-${type}`,
    canvasId: "canvas-1",
    type,
    positionX: 10,
    positionY: 20,
    width: 200,
    height: 100,
    zIndex: 1,
    version: 3,
    content: {} as CanvasItem["content"],
  } as CanvasItem;
}

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ version: 4 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("capability resolution per role", () => {
  it.each([
    ["OWNER", true, true, true],
    ["EDIT", true, true, false],
    ["COMMENT", false, true, false],
    ["VIEW", false, false, false],
  ] as const)(
    "%s: move=%s comment=%s manage=%s",
    (role, canMove, canComment, canManage) => {
      const capabilities = resolveCanvasCapabilities(role);

      expect(capabilities.canMoveItems).toBe(canMove);
      expect(capabilities.canResizeItems).toBe(canMove);
      expect(capabilities.canEditItems).toBe(canMove);
      expect(capabilities.canDeleteItems).toBe(canMove);
      expect(capabilities.canComment).toBe(canComment);
      expect(capabilities.canManageCanvas).toBe(canManage);
    },
  );

  it.each(ALL_ROLES)(
    "never grants client-side voting to %s (DEC-005)",
    (role) => {
      expect(resolveCanvasCapabilities(role).canVote).toBe(false);
    },
  );
});

describe("every item type has an explicit geometry stance", () => {
  it.each(ALL_ITEM_TYPES)("%s declares whether it is resizable", (type) => {
    expect(typeof isItemResizable(type)).toBe("boolean");
  });

  it("limits resize handles to the types that implement them", () => {
    expect([...RESIZABLE_ITEM_TYPES].sort()).toEqual(
      [ItemType.NOTE, ItemType.BOOKMARK, ItemType.IMAGE].sort(),
    );
  });
});

describe("one gesture, one durable write", () => {
  it.each(ALL_ITEM_TYPES)(
    "persists a move for %s exactly once",
    async (type) => {
      const { result } = renderHook(() =>
        useItemGeometry({ capabilities: resolveCanvasCapabilities("EDIT") }),
      );

      act(() => {
        expect(
          result.current.commitGeometry(makeItem(type), {
            positionX: 120,
            positionY: 240,
          }),
        ).toBe(true);
      });

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      expect(mutateAsync).toHaveBeenCalledWith({
        itemId: `item-${type}`,
        data: { positionX: 120, positionY: 240, version: 3 },
      });
    },
  );

  it("coalesces gestures queued during an in-flight save into one further write", async () => {
    let resolveFirst: (value: { version: number }) => void = () => {};
    mutateAsync.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );

    const { result } = renderHook(() =>
      useItemGeometry({ capabilities: resolveCanvasCapabilities("OWNER") }),
    );
    const item = makeItem(ItemType.NOTE);

    act(() => {
      result.current.commitGeometry(item, { positionX: 1, positionY: 1 });
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.commitGeometry(item, { positionX: 2, positionY: 2 });
      result.current.commitGeometry(item, { positionX: 3, positionY: 3 });
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ version: 4 });
    });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenLastCalledWith({
      itemId: item.id,
      data: { positionX: 3, positionY: 3, version: 4 },
    });
  });

  it("advances the optimistic version from the server response", async () => {
    mutateAsync.mockResolvedValueOnce({ version: 9 });

    const { result } = renderHook(() =>
      useItemGeometry({ capabilities: resolveCanvasCapabilities("EDIT") }),
    );
    const item = makeItem(ItemType.SHAPE);

    act(() => {
      result.current.commitGeometry(item, { positionX: 1, positionY: 1 });
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.commitGeometry(item, { positionX: 5, positionY: 5 });
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));

    expect(mutateAsync).toHaveBeenLastCalledWith({
      itemId: item.id,
      data: { positionX: 5, positionY: 5, version: 9 },
    });
  });

  it("reports a version conflict to the caller instead of dropping it", async () => {
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    mutateAsync.mockRejectedValueOnce(conflict);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useItemGeometry({
        capabilities: resolveCanvasCapabilities("EDIT"),
        onError,
      }),
    );

    act(() => {
      result.current.commitGeometry(makeItem(ItemType.NOTE), {
        positionX: 7,
        positionY: 7,
      });
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith(conflict));
  });
});

describe("roles without the capability create no local mutation", () => {
  it.each(
    (["COMMENT", "VIEW"] as const).flatMap((role) =>
      ALL_ITEM_TYPES.map((type) => [role, type] as const),
    ),
  )("%s cannot move %s", async (role, type) => {
    const { result } = renderHook(() =>
      useItemGeometry({ capabilities: resolveCanvasCapabilities(role) }),
    );

    act(() => {
      expect(
        result.current.commitGeometry(makeItem(type), {
          positionX: 99,
          positionY: 99,
        }),
      ).toBe(false);
    });

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it.each(ALL_ROLES)("%s cannot resize a non-resizable type", (role) => {
    const { result } = renderHook(() =>
      useItemGeometry({ capabilities: resolveCanvasCapabilities(role) }),
    );

    act(() => {
      expect(
        result.current.commitGeometry(makeItem(ItemType.DRAWING), {
          positionX: 1,
          positionY: 1,
          width: 500,
          height: 500,
        }),
      ).toBe(false);
    });

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it.each([ItemType.NOTE, ItemType.BOOKMARK, ItemType.IMAGE])(
    "an editor resizes %s through the same single path",
    async (type) => {
      const { result } = renderHook(() =>
        useItemGeometry({ capabilities: resolveCanvasCapabilities("EDIT") }),
      );

      act(() => {
        expect(
          result.current.commitGeometry(makeItem(type), {
            positionX: 4,
            positionY: 5,
            width: 320,
            height: 240,
          }),
        ).toBe(true);
      });

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      expect(mutateAsync).toHaveBeenCalledWith({
        itemId: `item-${type}`,
        data: {
          positionX: 4,
          positionY: 5,
          width: 320,
          height: 240,
          version: 3,
        },
      });
    },
  );
});

describe("the shared drag adapter", () => {
  it("emits position only, never a size change", () => {
    const onCommitGeometry = vi.fn();

    commitGroupDragEnd(
      { target: { x: () => 42, y: () => 84 } },
      onCommitGeometry,
    );

    expect(onCommitGeometry).toHaveBeenCalledWith({
      positionX: 42,
      positionY: 84,
    });
  });
});
