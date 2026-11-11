// @vitest-environment happy-dom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.hoisted(() => vi.fn());
const editorValues = vi.hoisted(() => [] as unknown[]);

vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useUpdateCanvasItem: () => ({ mutateAsync, mutate: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-canvas-document", () => ({
  useCanvasDocument: () => null,
  useCanvasDocumentSnapshot: () => ({ items: new Map(), writable: false }),
}));
// A plain textarea stands in for the rich-text editor: it shows the text of
// the content it was given and reports edits as a one-paragraph document.
vi.mock("@/components/RichTextEditor", () => ({
  EMPTY_VERSIONED_NOTE_CONTENT: {
    formatVersion: 1,
    document: { type: "doc", content: [{ type: "paragraph" }] },
    plainText: "",
    text: "<p></p>",
  },
  RichTextEditor: ({
    content,
    onChange,
  }: {
    content: { plainText?: string } | null;
    onChange: (value: unknown) => void;
  }) => {
    editorValues.push(content);
    return (
      <textarea
        aria-label="editor"
        value={content?.plainText ?? ""}
        onChange={(event) =>
          onChange({
            formatVersion: 1,
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: event.target.value }],
                },
              ],
            },
            plainText: event.target.value,
            text: `<p>${event.target.value}</p>`,
          })
        }
      />
    );
  },
}));

import { EditNoteDialog } from "@/features/canvas/components/EditNoteDialog";
import { type CanvasItem, ItemType } from "@/types/canvas";

function item(type: ItemType, content: Record<string, unknown>): CanvasItem {
  return {
    id: "i1",
    canvasId: "c1",
    type,
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 50,
    zIndex: 1,
    content,
    version: 4,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CanvasItem;
}

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({});
  editorValues.length = 0;
});
afterEach(cleanup);

const goodNote = (tags: string[]) => ({
  ...item(ItemType.NOTE, { text: "<p>first</p>" }),
  id: "good",
  tags,
});
const emptyNote = {
  ...item(ItemType.NOTE, {
    formatVersion: 1,
    document: { type: "doc", content: [{ type: "paragraph" }] },
    plainText: "",
    text: "<p></p>",
  }),
  id: "empty",
  tags: ["kept-tag"],
};
const brokenNote = {
  ...item(ItemType.NOTE, {
    formatVersion: 1,
    document: { type: "not-a-doc" },
    text: "x",
  }),
  id: "broken",
  tags: ["broken-tag"],
};

describe("EditNoteDialog load failures", () => {
  it("loads a stored empty note with its own tags", async () => {
    render(<EditNoteDialog open onClose={vi.fn()} item={emptyNote} />);
    expect(await screen.findByText("kept-tag")).toBeTruthy();
    expect(screen.queryByText(/cannot be edited|unsupported/i)).toBeNull();
  });

  it("blocks saving a note that cannot be normalized, even after editing another", async () => {
    const { rerender } = render(
      <EditNoteDialog open onClose={vi.fn()} item={goodNote(["old-tag"])} />,
    );
    expect(await screen.findByText("old-tag")).toBeTruthy();
    rerender(<EditNoteDialog open onClose={vi.fn()} item={brokenNote} />);

    const save = await screen.findByRole("button", { name: "Save Changes" });
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(true),
    );
    await act(async () => {
      fireEvent.click(save);
      fireEvent.submit(save.closest("form")!);
    });
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText("old-tag")).toBeNull();
  });
});
