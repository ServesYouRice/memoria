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

async function editAndSave(value: string) {
  fireEvent.change(screen.getByLabelText("editor"), {
    target: { value },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  });
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  return mutateAsync.mock.calls[0]![0] as {
    data: { content: Record<string, unknown> };
  };
}

describe("EditNoteDialog with a TEXT item", () => {
  it("loads the stored text as plain text and saves style fields plus plain text", async () => {
    const textItem = item(ItemType.TEXT, {
      text: "a <b>literal</b> & sign",
      fontSize: 32,
      fontFamily: "Georgia",
      color: "#ff0000",
      align: "center",
    });
    render(<EditNoteDialog open onClose={vi.fn()} item={textItem} />);
    await waitFor(() =>
      expect(
        (screen.getByLabelText("editor") as HTMLTextAreaElement).value,
      ).toBe("a <b>literal</b> & sign"),
    );

    const call = await editAndSave("Big <title> & more");
    expect(call.data.content).toEqual({
      text: "Big <title> & more",
      fontSize: 32,
      fontFamily: "Georgia",
      color: "#ff0000",
      align: "center",
    });
  });
});

describe("EditNoteDialog with a NOTE item", () => {
  it("still saves normalized note content", async () => {
    render(
      <EditNoteDialog
        open
        onClose={vi.fn()}
        item={item(ItemType.NOTE, { text: "<p>hello</p>" })}
      />,
    );
    const call = await editAndSave("updated");
    expect(call.data.content).toMatchObject({
      formatVersion: 1,
      plainText: "updated",
      text: "<p>updated</p>",
    });
  });
});
