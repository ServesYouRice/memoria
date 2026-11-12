import { describe, expect, it } from "vitest";
import { ItemType, type CanvasItem } from "@/types/canvas";
import { planJsonCanvas, toJsonCanvas } from "@/lib/canvas-formats/json-canvas";
import { planExcalidraw } from "@/lib/canvas-formats/excalidraw";
import {
  detectCanvasFormat,
  planCanvasFile,
  resolvePlan,
} from "@/lib/canvas-formats/import-canvas";

function item(
  id: string,
  type: ItemType,
  content: Record<string, unknown>,
  geometry: Partial<CanvasItem> = {},
): CanvasItem {
  return {
    id,
    canvasId: "c1",
    type,
    positionX: 0,
    positionY: 0,
    width: 200,
    height: 100,
    zIndex: 1,
    version: 1,
    content,
    tags: [],
    createdAt: "",
    updatedAt: "",
    ...geometry,
  } as CanvasItem;
}

const board = [
  item(
    "frame",
    ItemType.FRAME,
    { title: "Trip" },
    { width: 800, height: 400, zIndex: 0 },
  ),
  item(
    "note",
    ItemType.NOTE,
    { text: "<p>Flights</p>", plainText: "Flights", color: "blue" },
    { positionX: 10.4, positionY: 20 },
  ),
  item(
    "link",
    ItemType.BOOKMARK,
    { url: "https://example.com/hotel", title: "Hotel" },
    { positionX: 400 },
  ),
  item("arrow", ItemType.ARROW, {
    startItemId: "note",
    endItemId: "link",
    arrowHeadStart: "none",
    arrowHeadEnd: "arrow",
    label: "then",
  }),
  item("loose", ItemType.ARROW, { startPoint: { x: 0, y: 0 } }),
  item("sketch", ItemType.DRAWING, { paths: [] }),
];

describe("JSON Canvas export (IMP-096)", () => {
  it("writes text, link and group nodes in z-order, edges for attached arrows, and lists the rest", () => {
    const { file, leftOut } = toJsonCanvas(board);
    expect(file.nodes.map((node) => [node.id, node.type])).toEqual([
      ["frame", "group"],
      ["link", "link"],
      ["note", "text"],
    ]);
    expect(file.nodes.find((node) => node.id === "note")).toMatchObject({
      text: "Flights",
      color: "5",
      x: 10,
    });
    expect(file.nodes[0]).toMatchObject({ label: "Trip" });
    expect(file.edges).toEqual([
      { id: "arrow", fromNode: "note", toNode: "link", label: "then" },
    ]);
    expect(leftOut).toEqual({
      "free drawings": 1,
      "arrows not joining two items": 1,
    });
  });

  it("round-trips notes, links, groups and arrows", () => {
    const { file } = toJsonCanvas(board);
    const { rows, brought, leftOut } = resolvePlan(planJsonCanvas(file));
    expect(brought).toEqual({
      "groups and frames": 1,
      links: 1,
      notes: 1,
      arrows: 1,
    });
    expect(leftOut).toEqual({});
    const byType = (type: ItemType) =>
      rows.filter((row) => row.planned.type === type);
    expect(byType(ItemType.NOTE)[0]!.content).toMatchObject({
      plainText: "Flights",
      color: "blue",
    });
    expect(byType(ItemType.BOOKMARK)[0]!.content.url).toBe(
      "https://example.com/hotel",
    );
    expect(byType(ItemType.FRAME)[0]!.content).toEqual({ title: "Trip" });
    const arrow = byType(ItemType.ARROW)[0]!;
    expect(arrow.content).toMatchObject({
      startItemId: byType(ItemType.NOTE)[0]!.id,
      endItemId: byType(ItemType.BOOKMARK)[0]!.id,
      label: "then",
    });
    // Same layout.
    expect(byType(ItemType.NOTE)[0]!.planned).toMatchObject({
      positionX: 10,
      positionY: 20,
      width: 200,
    });
  });
});

describe("JSON Canvas import is careful with untrusted files", () => {
  it("never follows file paths, keeps only web links and plain text", () => {
    const { rows, leftOut } = resolvePlan(
      planJsonCanvas({
        nodes: [
          {
            id: "f",
            type: "file",
            file: "/etc/passwd",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          {
            id: "j",
            type: "link",
            url: "javascript:alert(1)",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          {
            id: "t",
            type: "text",
            text: "<script>x</script> **hi**",
            x: 0,
            y: 0,
            width: 9,
            height: 9,
          },
        ],
        edges: [{ id: "e", fromNode: "f", toNode: "t" }],
      }),
    );
    expect(leftOut).toEqual({
      "files from the author's computer": 1,
      "links that are not web addresses": 1,
      "connections to missing nodes": 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content.plainText).toBe("<script>x</script> **hi**");
    expect(String(rows[0]!.content.text)).not.toContain("<script>");
  });

  it("detects the format and rejects other JSON", () => {
    expect(detectCanvasFormat("x.canvas", {})).toBe("json-canvas");
    expect(detectCanvasFormat("x.json", { elements: [] })).toBe("excalidraw");
    const detail = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return (error as { detail?: string }).detail;
      }
    };
    expect(detail(() => planCanvasFile("{}", "notes.json"))).toContain(
      "not a .canvas or .excalidraw file",
    );
    expect(detail(() => planCanvasFile("nope", "a.canvas"))).toBe(
      "This file is not valid JSON.",
    );
  });
});

describe("Excalidraw import (IMP-096)", () => {
  const file = {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [
      {
        id: "r",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        strokeColor: "#1e1e1e",
        backgroundColor: "#ffc9c9",
        strokeWidth: 2,
      },
      {
        id: "e",
        type: "ellipse",
        x: 300,
        y: 0,
        width: 80,
        height: 80,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
      },
      {
        id: "t",
        type: "text",
        x: 10,
        y: 200,
        width: 60,
        height: 25,
        text: "Hello",
        fontSize: 20,
        textAlign: "left",
        strokeColor: "#1971c2",
      },
      {
        id: "a",
        type: "arrow",
        x: 100,
        y: 25,
        width: 200,
        height: 15,
        points: [
          [0, 0],
          [100, 30],
          [200, 15],
        ],
        startBinding: { elementId: "r", focus: 0, gap: 1 },
        endBinding: { elementId: "e", focus: 0, gap: 1 },
        startArrowhead: null,
        endArrowhead: "arrow",
        strokeStyle: "dashed",
      },
      {
        id: "al",
        type: "text",
        x: 150,
        y: 20,
        width: 30,
        height: 20,
        text: "next",
        containerId: "a",
      },
      {
        id: "d",
        type: "freedraw",
        x: 50,
        y: 300,
        width: 20,
        height: 10,
        points: [
          [0, 0],
          [10, 5],
          [20, 10],
        ],
        strokeColor: "#000000",
        opacity: 50,
      },
      {
        id: "f",
        type: "frame",
        x: -20,
        y: -20,
        width: 500,
        height: 400,
        name: "Plan",
      },
      {
        id: "i",
        type: "image",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fileId: "abc",
      },
      {
        id: "gone",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        isDeleted: true,
      },
      {
        id: "spin",
        type: "diamond",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        angle: 0.5,
      },
    ],
    appState: {},
    files: {},
  };

  it("brings in shapes, text, arrows, free drawings and frames, and says what it left out", () => {
    const plan = planExcalidraw(file);
    expect(plan.brought).toEqual({
      shapes: 3,
      text: 1,
      "arrows and lines": 1,
      "free drawings": 1,
      frames: 1,
    });
    expect(plan.leftOut).toEqual({
      "embedded images": 1,
      "bends (lines drawn straight)": 1,
      "rotations (drawn upright)": 1,
    });
    const { rows } = resolvePlan(plan);
    const rect = rows.find((row) => row.planned.key === "r")!;
    expect(rect.content).toMatchObject({
      shapeType: "rectangle",
      fill: "#ffc9c9",
    });
    const arrow = rows.find((row) => row.planned.key === "a")!;
    const ellipse = rows.find((row) => row.planned.key === "e")!;
    expect(arrow.content).toMatchObject({
      startItemId: rect.id,
      endItemId: ellipse.id,
      label: "next",
      lineStyle: "DASHED",
      arrowHeadEnd: "arrow",
    });
    const drawing = rows.find((row) => row.planned.key === "d")!;
    expect(drawing.planned).toMatchObject({
      positionX: 50,
      positionY: 300,
      width: 20,
    });
    expect(drawing.content.paths).toEqual([
      expect.objectContaining({ points: [0, 0, 10, 5, 20, 10], opacity: 0.5 }),
    ]);
    expect(rows.find((row) => row.planned.key === "t")!.content).toMatchObject({
      text: "Hello",
      fontSize: 20,
      color: "#1971c2",
    });
  });

  it("thins very long free drawings to fit", () => {
    const points = Array.from({ length: 5000 }, (_, i) => [i, i % 7]);
    const plan = planExcalidraw({
      type: "excalidraw",
      elements: [{ id: "d", type: "freedraw", x: 0, y: 0, points }],
    });
    const { rows } = resolvePlan(plan);
    expect(
      (rows[0]!.content.paths as Array<{ points: number[] }>)[0]!.points,
    ).toHaveLength(2000);
  });
});
