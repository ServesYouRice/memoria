// @vitest-environment happy-dom
/**
 * IMP-142: double-clicking a wide note with live editing types on the note
 * itself; everything else keeps the note dialog. Typing there never reaches
 * the canvas shortcuts.
 */
import type React from "react";
import type Konva from "konva";
import * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type * as ThemeContextModule from "@/lib/theme-context";
import type {
  CanvasDocumentSession,
  CanvasDocumentSnapshot,
} from "@/lib/collaboration/sync/client-session";
import { NoteInlineEditor } from "@/features/canvas/components/NoteInlineEditor";
import { useCanvasKeyboard } from "@/features/canvas/hooks/use-canvas-keyboard";
import { liveNoteFragment } from "@/features/canvas/lib/live-note";
import { editsNoteInPlace } from "@/features/canvas/lib/note-screen-rect";
import { type CanvasItem, ItemType } from "@/types/canvas";

vi.mock("@/lib/theme-context", async (importOriginal) => ({
  ...(await importOriginal<typeof ThemeContextModule>()),
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));

const note = {
  id: "cnote",
  canvasId: "ccanvas",
  type: ItemType.NOTE,
  positionX: 100,
  positionY: 80,
  width: 240,
  height: 180,
  zIndex: 0,
  version: 1,
  tags: [],
  content: { formatVersion: 1, document: { type: "doc", content: [] } },
} as unknown as CanvasItem;

function liveSession(fragment: Y.XmlFragment | null, writable = true) {
  const session = {
    acceptsWrites: writable,
    noteFragment: () => fragment,
  } as unknown as CanvasDocumentSession;
  const snapshot = {
    writable,
    items: new Map([[note.id, {}]]),
  } as unknown as CanvasDocumentSnapshot;
  return { session, snapshot };
}

function liveEditing(writable = true): boolean {
  const fragment = new Y.Doc().getXmlFragment("note");
  const { session, snapshot } = liveSession(fragment, writable);
  return liveNoteFragment(session, snapshot, note.id) !== null;
}

function renderEditor() {
  const fragment = new Y.Doc().getXmlFragment("note");
  const onClose = vi.fn();
  const onTags = vi.fn();
  const onDelete = vi.fn();
  const nudgeItem = vi.fn();
  // The board's own shortcuts, listening on the window as on the canvas.
  renderHook(() =>
    useCanvasKeyboard({
      onDelete,
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onSelectAll: vi.fn(),
      onDuplicate: vi.fn(),
      onEscape: vi.fn(),
      canEdit: true,
      isDrawing: false,
      stageRef: { current: null } as unknown as React.RefObject<Konva.Stage>,
      onChatOpen: vi.fn(),
      onReactionOpen: vi.fn(),
      selectedItemIds: new Set<string>(),
      selectedItemId: note.id,
      allItems: [note],
      nudgeItem,
    }),
  );
  render(
    <div>
      <button type="button">Board</button>
      <NoteInlineEditor
        item={note}
        fragment={fragment}
        position={{ x: 0, y: 0 }}
        zoom={1}
        viewportHeight={800}
        onClose={onClose}
        onTags={onTags}
      />
    </div>,
  );
  return { onClose, onTags, onDelete, nudgeItem };
}

async function editorText(): Promise<HTMLElement> {
  const group = screen.getByRole("group", { name: "Editing note" });
  await waitFor(() =>
    expect(group.querySelector(".ProseMirror")).not.toBeNull(),
  );
  return group.querySelector(".ProseMirror") as HTMLElement;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("choosing in-place editing or the dialog", () => {
  it("edits a wide note in place while live editing is available", () => {
    expect(editsNoteInPlace(note, 1, liveEditing())).toBe(true);
  });

  it("uses the dialog for a TEXT item", () => {
    expect(
      editsNoteInPlace({ ...note, type: ItemType.TEXT }, 1, liveEditing()),
    ).toBe(false);
  });

  it("uses the dialog for a note under 160px wide on screen", () => {
    // 240 * 0.6 = 144px on screen.
    expect(editsNoteInPlace(note, 0.6, liveEditing())).toBe(false);
    // 240 * 2/3 = 160px: wide enough.
    expect(editsNoteInPlace(note, 2 / 3, liveEditing())).toBe(true);
  });

  it("uses the dialog when live editing is off", () => {
    expect(liveEditing(false)).toBe(false);
    expect(editsNoteInPlace(note, 1, liveEditing(false))).toBe(false);
    const { session, snapshot } = liveSession(null);
    expect(liveNoteFragment(session, snapshot, "missing")).toBeNull();
    expect(liveNoteFragment(null, snapshot, note.id)).toBeNull();
  });
});

describe("NoteInlineEditor", () => {
  it("shows an editable note with the cursor in it", async () => {
    renderEditor();
    const text = await editorText();
    expect(text.getAttribute("contenteditable")).toBe("true");
    await waitFor(() =>
      expect(text.contains(document.activeElement)).toBe(true),
    );
  });

  it("closes on Escape", async () => {
    const { onClose } = renderEditor();
    const text = await editorText();
    fireEvent.keyDown(text, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click outside, not inside", async () => {
    const { onClose } = renderEditor();
    const text = await editorText();
    fireEvent.pointerDown(text);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Board" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from Done and opens the dialog from Tags", async () => {
    const { onClose, onTags } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(onTags).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Delete, Backspace, arrows and Space out of the canvas shortcuts", async () => {
    const { onDelete, nudgeItem, onClose } = renderEditor();
    const text = await editorText();
    text.focus();
    for (const key of ["Delete", "Backspace", "ArrowLeft", " ", "/"]) {
      text.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    }
    expect(onDelete).not.toHaveBeenCalled();
    expect(nudgeItem).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // The same key outside the editor still deletes the selected note.
    text.blur();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
