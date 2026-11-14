// @vitest-environment happy-dom
/**
 * IMP-143: "Note" drops an empty note in the middle of the visible board and
 * opens it for typing in place; without live editing it opens the dialog.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { EMPTY_VERSIONED_NOTE_CONTENT } from "@/components/RichTextEditor";
import {
  newNotePosition,
  useAddNote,
  type UseAddNoteOptions,
} from "@/features/canvas/hooks/use-add-note";
import { type CanvasItem, ItemType } from "@/types/canvas";

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMocks, Toaster: () => null }));

const CANVAS_ID = "ccanvas00000000000000000";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createdNote(input: { positionX: number; positionY: number }) {
  return {
    id: "cnew",
    canvasId: CANVAS_ID,
    type: ItemType.NOTE,
    width: 200,
    height: 200,
    zIndex: 1,
    version: 1,
    tags: [],
    content: EMPTY_VERSIONED_NOTE_CONTENT,
    ...input,
  } as unknown as CanvasItem;
}

function setup(overrides: Partial<UseAddNoteOptions> = {}) {
  const options: UseAddNoteOptions = {
    canvasId: CANVAS_ID,
    canCreateItems: true,
    liveEditing: true,
    // Panned and zoomed: the visible centre is world (300, 150).
    position: { x: -200, y: 100 },
    stageSize: { width: 800, height: 600 },
    zoom: 2,
    items: [],
    createItem: vi.fn(async (input) => createdNote(input)),
    openDialog: vi.fn(),
    onCreated: vi.fn(),
    ...overrides,
  };
  const { result } = renderHook(() => useAddNote(options));
  return { options, press: () => result.current() };
}

afterEach(() => vi.clearAllMocks());

describe("pressing Note", () => {
  it("creates an empty note centred on the visible board, then opens it in place", async () => {
    const { options, press } = setup();
    await act(press);

    expect(options.createItem).toHaveBeenCalledTimes(1);
    expect(options.createItem).toHaveBeenCalledWith({
      canvasId: CANVAS_ID,
      type: ItemType.NOTE,
      // (-(-200) + 800 / 2) / 2 = 300; (-100 + 600 / 2) / 2 = 100.
      positionX: 300 - 100,
      positionY: 100 - 100,
      width: 200,
      height: 200,
      zIndex: 1,
      content: EMPTY_VERSIONED_NOTE_CONTENT,
      tags: [],
    });
    expect(options.onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cnew" }),
      true,
    );
    expect(options.openDialog).not.toHaveBeenCalled();
  });

  it("opens the dialog when live editing is off", async () => {
    const { options, press } = setup({ liveEditing: false });
    await act(press);
    expect(options.openDialog).toHaveBeenCalledTimes(1);
    expect(options.createItem).not.toHaveBeenCalled();
  });

  it("does nothing for someone who may not add items", async () => {
    const { options, press } = setup({ canCreateItems: false });
    await act(press);
    expect(options.openDialog).not.toHaveBeenCalled();
    expect(options.createItem).not.toHaveBeenCalled();
  });

  it("ignores a second press while the first create is pending", async () => {
    const pending = deferred<CanvasItem>();
    const createItem = vi.fn(() => pending.promise);
    const { press } = setup({ createItem });

    let first!: Promise<void>;
    act(() => {
      first = press();
    });
    await act(press);
    expect(createItem).toHaveBeenCalledTimes(1);

    pending.resolve(createdNote({ positionX: 200, positionY: 0 }));
    await act(() => first);
    await act(press);
    expect(createItem).toHaveBeenCalledTimes(2);
  });

  it("selects without opening an editor when zoomed too far out", async () => {
    // 200 * 0.5 = 100px on screen: under the in-place minimum.
    const { options, press } = setup({ zoom: 0.5 });
    await act(press);
    expect(options.onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cnew" }),
      false,
    );
  });

  it("reports a failed create", async () => {
    const { options, press } = setup({
      createItem: vi.fn(() => Promise.reject(new Error("offline"))),
    });
    await act(press);
    expect(toastMocks.error).toHaveBeenCalledWith("The note was not added.");
    expect(options.onCreated).not.toHaveBeenCalled();
  });
});

describe("newNotePosition", () => {
  const center = { x: 300, y: 300 };

  it("centres the note when the spot is free", () => {
    expect(newNotePosition(center, [])).toEqual({ x: 200, y: 200 });
  });

  it("moves 24 right and down off notes at exactly that spot", () => {
    const items = [
      { positionX: 200, positionY: 200 },
      { positionX: 224, positionY: 224 },
    ];
    expect(newNotePosition(center, items)).toEqual({ x: 248, y: 248 });
    // A near miss is not "exactly there".
    expect(
      newNotePosition(center, [{ positionX: 201, positionY: 200 }]),
    ).toEqual({ x: 200, y: 200 });
  });

  it("stops after ten steps", () => {
    const items = Array.from({ length: 20 }, (_, step) => ({
      positionX: 200 + step * 24,
      positionY: 200 + step * 24,
    }));
    expect(newNotePosition(center, items)).toEqual({ x: 440, y: 440 });
  });
});
