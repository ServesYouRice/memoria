/**
 * Excalidraw drawings (`.excalidraw`), IMP-096. The file is
 * `{ type: "excalidraw", version, source, elements, appState, files }`;
 * element fields follow `@excalidraw/excalidraw` 0.18 `element/types`.
 * Linear and free-draw `points` are relative to the element's `x`/`y`.
 *
 * Rectangles, ellipses and diamonds become shapes, text becomes text (a
 * label on an arrow becomes the arrow's label), arrows and lines become
 * arrows (attached when bound at both ends), free drawings become drawings,
 * frames become frames. Embedded images and web embeds are left out, and
 * rotation is not kept.
 */

import { z } from "zod";
import { ItemType } from "@/types/canvas";
import {
  MAX_FILE_ELEMENTS,
  bump,
  cleanText,
  coordinate,
  size,
  type ImportPlan,
  type PlannedItem,
} from "./types";

/** Drawing paths hold at most 2000 numbers, so 1000 points. */
const MAX_DRAWING_POINTS = 1000;

const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);

const elementSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.string().max(40),
    x: z.unknown(),
    y: z.unknown(),
    width: z.unknown().optional(),
    height: z.unknown().optional(),
    isDeleted: z.boolean().optional(),
    strokeColor: z.unknown().optional(),
    backgroundColor: z.unknown().optional(),
    strokeWidth: z.unknown().optional(),
    strokeStyle: z.unknown().optional(),
    opacity: z.unknown().optional(),
    angle: z.unknown().optional(),
    text: z.unknown().optional(),
    fontSize: z.unknown().optional(),
    textAlign: z.unknown().optional(),
    containerId: z.unknown().optional(),
    name: z.unknown().optional(),
    points: z.array(z.unknown()).max(50_000).optional(),
    startBinding: z.unknown().optional(),
    endBinding: z.unknown().optional(),
    startArrowhead: z.unknown().optional(),
    endArrowhead: z.unknown().optional(),
  })
  .passthrough();

type Element = z.infer<typeof elementSchema>;

const fileSchema = z.object({
  type: z.literal("excalidraw").optional(),
  elements: z.array(z.unknown()).max(MAX_FILE_ELEMENTS),
});

/** True when parsed JSON looks like an Excalidraw file. */
export function looksLikeExcalidraw(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { elements?: unknown }).elements) &&
    ((value as { type?: unknown }).type === "excalidraw" ||
      !("nodes" in (value as object)))
  );
}

/** A colour Memoria can store: `#rgb`/`#rrggbb`, `transparent` or none. */
function color(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "transparent") return value;
  return /^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(value)
    ? value
    : undefined;
}

function strokeWidth(value: unknown) {
  return typeof value === "number" && value > 0 && value <= 100 ? value : 2;
}

function points(element: Element) {
  const list: Array<[number, number]> = [];
  for (const raw of element.points ?? []) {
    const parsed = pointSchema.safeParse(raw);
    if (parsed.success) list.push(parsed.data);
  }
  return list;
}

function bindingId(value: unknown) {
  return value &&
    typeof value === "object" &&
    typeof (value as { elementId?: unknown }).elementId === "string"
    ? (value as { elementId: string }).elementId
    : undefined;
}

function head(value: unknown): "none" | "arrow" | "circle" {
  if (value === null || value === undefined) return "none";
  return value === "dot" || value === "circle" || value === "circle_outline"
    ? "circle"
    : "arrow";
}

const SHAPE_TYPES: Record<string, string> = {
  rectangle: "rectangle",
  ellipse: "circle",
  diamond: "diamond",
};

/** Plan the items of a parsed Excalidraw file. Throws on a malformed file. */
export function planExcalidraw(value: unknown): ImportPlan {
  const file = fileSchema.parse(value);
  const brought: Record<string, number> = {};
  const leftOut: Record<string, number> = {};
  const elements: Element[] = [];
  for (const raw of file.elements) {
    const parsed = elementSchema.safeParse(raw);
    if (!parsed.success) {
      bump(leftOut, "unreadable elements");
      continue;
    }
    if (!parsed.data.isDeleted) elements.push(parsed.data);
  }
  const byId = new Map(elements.map((element) => [element.id, element]));
  const arrowLabels = new Map<string, string>();
  for (const element of elements) {
    const container =
      typeof element.containerId === "string"
        ? byId.get(element.containerId)
        : undefined;
    if (element.type === "text" && container?.type === "arrow") {
      arrowLabels.set(container.id, cleanText(element.text, 100).trim());
    }
  }

  const items: PlannedItem[] = [];
  let rotated = 0;
  for (const element of elements) {
    const x = coordinate(element.x);
    const y = coordinate(element.y);
    const box = {
      key: element.id,
      positionX: x,
      positionY: y,
      width: size(element.width, 1),
      height: size(element.height, 1),
    };
    if (typeof element.angle === "number" && Math.abs(element.angle) > 0.01) {
      rotated += 1;
    }
    const stroke = color(element.strokeColor);

    if (element.type in SHAPE_TYPES) {
      const fill = color(element.backgroundColor);
      items.push({
        ...box,
        type: ItemType.SHAPE,
        content: {
          shapeType: SHAPE_TYPES[element.type],
          ...(stroke ? { stroke } : {}),
          fill: fill ?? "transparent",
          strokeWidth: strokeWidth(element.strokeWidth),
        },
      });
      bump(brought, "shapes");
    } else if (element.type === "text") {
      const container =
        typeof element.containerId === "string"
          ? byId.get(element.containerId)
          : undefined;
      if (container?.type === "arrow") continue; // kept as the arrow's label
      const text = cleanText(element.text, 50_000);
      if (!text.trim()) continue;
      const align = ["left", "center", "right"].includes(
        element.textAlign as string,
      )
        ? (element.textAlign as string)
        : undefined;
      items.push({
        ...box,
        type: ItemType.TEXT,
        content: {
          text,
          ...(typeof element.fontSize === "number" &&
          element.fontSize > 0 &&
          element.fontSize <= 500
            ? { fontSize: element.fontSize }
            : {}),
          ...(align ? { align } : {}),
          ...(stroke && stroke !== "transparent" ? { color: stroke } : {}),
        },
      });
      bump(brought, "text");
    } else if (element.type === "arrow" || element.type === "line") {
      const path = points(element);
      if (path.length < 2) {
        bump(leftOut, "unreadable elements");
        continue;
      }
      if (path.length > 2) bump(leftOut, "bends (lines drawn straight)");
      const first = path[0]!;
      const last = path[path.length - 1]!;
      const start = { x: x + first[0], y: y + first[1] };
      const end = { x: x + last[0], y: y + last[1] };
      const left = Math.min(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const label = arrowLabels.get(element.id);
      const isArrow = element.type === "arrow";
      const startKey = isArrow ? bindingId(element.startBinding) : undefined;
      const endKey = isArrow ? bindingId(element.endBinding) : undefined;
      items.push({
        key: element.id,
        type: ItemType.ARROW,
        positionX: left,
        positionY: top,
        width: Math.max(Math.abs(end.x - start.x), 1),
        height: Math.max(Math.abs(end.y - start.y), 1),
        ...(startKey ? { startKey } : {}),
        ...(endKey ? { endKey } : {}),
        content: {
          startPoint: { x: start.x - left, y: start.y - top },
          endPoint: { x: end.x - left, y: end.y - top },
          arrowHeadStart: isArrow ? head(element.startArrowhead) : "none",
          arrowHeadEnd: isArrow ? head(element.endArrowhead) : "none",
          ...(stroke && stroke !== "transparent" ? { stroke } : {}),
          strokeWidth: strokeWidth(element.strokeWidth),
          ...(element.strokeStyle === "dashed"
            ? { lineStyle: "DASHED" }
            : element.strokeStyle === "dotted"
              ? { lineStyle: "DOTTED" }
              : {}),
          ...(label ? { label } : {}),
        },
      });
      bump(brought, "arrows and lines");
    } else if (element.type === "freedraw") {
      let path = points(element);
      if (path.length < 2) continue;
      if (path.length > MAX_DRAWING_POINTS) {
        const step = path.length / MAX_DRAWING_POINTS;
        path = Array.from(
          { length: MAX_DRAWING_POINTS },
          (_, index) => path[Math.floor(index * step)]!,
        );
      }
      const minX = Math.min(...path.map((point) => point[0]));
      const minY = Math.min(...path.map((point) => point[1]));
      const maxX = Math.max(...path.map((point) => point[0]));
      const maxY = Math.max(...path.map((point) => point[1]));
      const opacity =
        typeof element.opacity === "number"
          ? Math.min(1, Math.max(0, element.opacity / 100))
          : 1;
      items.push({
        key: element.id,
        type: ItemType.DRAWING,
        positionX: x + minX,
        positionY: y + minY,
        width: Math.max(maxX - minX, 1),
        height: Math.max(maxY - minY, 1),
        content: {
          paths: [
            {
              points: path.flatMap((point) => [
                point[0] - minX,
                point[1] - minY,
              ]),
              stroke: stroke && stroke !== "transparent" ? stroke : "#1e1e1e",
              strokeWidth: strokeWidth(element.strokeWidth),
              opacity,
              tension: 0.5,
            },
          ],
        },
      });
      bump(brought, "free drawings");
    } else if (element.type === "frame" || element.type === "magicframe") {
      const title = cleanText(element.name, 200).trim();
      items.push({
        ...box,
        type: ItemType.FRAME,
        content: title ? { title } : {},
      });
      bump(brought, "frames");
    } else if (element.type === "image") {
      bump(leftOut, "embedded images");
    } else if (element.type === "embeddable" || element.type === "iframe") {
      bump(leftOut, "web embeds");
    } else {
      bump(leftOut, "unknown elements");
    }
  }
  if (rotated > 0) bump(leftOut, "rotations (drawn upright)", rotated);
  return { items, brought, leftOut };
}
