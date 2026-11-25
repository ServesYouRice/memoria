// @vitest-environment happy-dom

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const circles = vi.hoisted(() => ({
  list: [] as Array<{ radius?: number; strokeWidth?: number }>,
}));

vi.mock("react-konva", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Stage: passthrough,
    Layer: passthrough,
    Group: React.forwardRef(function Group(
      { children }: { children?: React.ReactNode },
      _ref,
    ) {
      return <div>{children}</div>;
    }),
    Rect: passthrough,
    Text: passthrough,
    Image: passthrough,
    Circle: (props: { radius?: number; strokeWidth?: number }) => {
      circles.list.push(props);
      return null;
    },
  };
});

vi.mock("@/lib/images/proxy-url", () => ({
  toImageProxyUrl: (url: string) => url,
}));

import {
  computeImageCanvasSize,
  looksLikeSupportedImage,
  parseClipboardHttpUrl,
  plainTextToNoteContent,
} from "@/features/canvas/components/CanvasBoard";
import { NoteItem } from "@/features/canvas/components/NoteItem";
import { BookmarkItem } from "@/features/canvas/components/BookmarkItem";
import { ImageItem } from "@/features/canvas/components/ImageItem";
import { useCanvasStore } from "@/stores/canvasStore";

afterEach(() => {
  cleanup();
  circles.list = [];
  act(() => {
    useCanvasStore.getState().setZoom(1);
  });
});

describe("drop and smart-paste helpers", () => {
  it("accepts PNG, JPEG, WebP, and GIF images and rejects SVG/text", () => {
    expect(looksLikeSupportedImage({ name: "a.png", type: "image/png" })).toBe(
      true,
    );
    expect(looksLikeSupportedImage({ name: "b.jpg", type: "image/jpeg" })).toBe(
      true,
    );
    expect(
      looksLikeSupportedImage({ name: "c.webp", type: "image/webp" }),
    ).toBe(true);
    expect(looksLikeSupportedImage({ name: "d.gif", type: "image/gif" })).toBe(
      true,
    );
    expect(looksLikeSupportedImage({ name: "e.webp", type: "" })).toBe(true);
    expect(
      looksLikeSupportedImage({ name: "icon.svg", type: "image/svg+xml" }),
    ).toBe(false);
    expect(
      looksLikeSupportedImage({ name: "doc.pdf", type: "application/pdf" }),
    ).toBe(false);
    expect(
      looksLikeSupportedImage({ name: "notes.txt", type: "text/plain" }),
    ).toBe(false);
  });

  it("parses single http(s) URLs from clipboard text", () => {
    expect(parseClipboardHttpUrl("  https://example.com/path?a=1  ")).toBe(
      "https://example.com/path?a=1",
    );
    expect(parseClipboardHttpUrl("http://localhost:3000/test")).toBe(
      "http://localhost:3000/test",
    );
    expect(parseClipboardHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseClipboardHttpUrl("not a url")).toBeNull();
    expect(
      parseClipboardHttpUrl("https://example.com https://other.com"),
    ).toBeNull();
  });

  it("normalizes plain clipboard text into a sticky note without stripping angle brackets", () => {
    const content = plainTextToNoteContent("x < y && y > z\n\nSecond line");
    expect(content.formatVersion).toBe(1);
    expect(content.plainText).toContain("x < y && y > z");
    expect(content.plainText).toContain("Second line");
  });

  it("caps dropped image display size at 400px while preserving aspect ratio", () => {
    expect(computeImageCanvasSize({ width: 1200, height: 600 })).toEqual({
      width: 400,
      height: 200,
    });
    expect(computeImageCanvasSize({ width: 250, height: 180 })).toEqual({
      width: 250,
      height: 180,
    });
  });
});

describe("zoom-invariant resize handles", () => {
  const capabilities = { canMoveItems: true, canResizeItems: true } as never;

  it.each([
    [
      "NoteItem",
      NoteItem,
      {
        id: "n1",
        canvasId: "c1",
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 200,
        height: 200,
        zIndex: 0,
        content: { text: "Note" },
        tags: [],
      },
    ],
    [
      "BookmarkItem",
      BookmarkItem,
      {
        id: "b1",
        canvasId: "c1",
        type: "BOOKMARK",
        positionX: 0,
        positionY: 0,
        width: 300,
        height: 150,
        zIndex: 0,
        content: { url: "https://example.com" },
        tags: [],
      },
    ],
    [
      "ImageItem",
      ImageItem,
      {
        id: "i1",
        canvasId: "c1",
        type: "IMAGE",
        positionX: 0,
        positionY: 0,
        width: 300,
        height: 200,
        zIndex: 0,
        content: { url: "https://example.com/a.png", filename: "a.png" },
        tags: [],
      },
    ],
  ] as const)(
    "scales %s resize handles inversely with zoom",
    (_name, Component, item) => {
      act(() => {
        useCanvasStore.getState().setZoom(0.5);
      });
      render(
        <Component
          item={item as never}
          isSelected
          capabilities={capabilities}
          onSelect={() => undefined}
          onContextMenu={() => undefined}
          onCommitGeometry={() => undefined}
        />,
      );
      const zoomedOutHandles = circles.list.slice(-4);
      expect(zoomedOutHandles).toHaveLength(4);
      for (const handle of zoomedOutHandles) {
        expect(handle.radius).toBe(14);
        expect(handle.strokeWidth).toBe(4);
      }

      act(() => {
        useCanvasStore.getState().setZoom(2);
      });
      const zoomedInHandles = circles.list.slice(-4);
      for (const handle of zoomedInHandles) {
        expect(handle.radius).toBe(3.5);
        expect(handle.strokeWidth).toBe(1);
      }
    },
  );
});
