/**
 * JSON Canvas 1.0 (`.canvas`, used by Obsidian), IMP-096. Spec:
 * https://jsoncanvas.org/spec/1.0/ — `nodes` (text, file, link, group; in
 * ascending z-order) and `edges` between nodes.
 *
 * Memoria → file: notes and text become text nodes, links and embeds link
 * nodes, frames groups, and arrows attached at both ends edges. Anything else
 * (free drawings, images, shapes, polls, loose arrows) is listed as left out.
 *
 * File → Memoria: text nodes become notes, link nodes links, groups frames,
 * edges attached arrows. File nodes point at paths on someone's disk and are
 * never followed.
 */

import { z } from "zod";
import {
  ItemType,
  type ArrowContent,
  type BookmarkContent,
  type CanvasItem,
  type FrameContent,
  type NoteContent,
  type TextContent,
} from "@/types/canvas";
import { NOTE_COLOR_NAMES, type NoteColorName } from "@/lib/note-colors";
import {
  MAX_FILE_ELEMENTS,
  bump,
  cleanText,
  coordinate,
  isWebUrl,
  plainTextToNoteHtml,
  size,
  type ImportPlan,
  type PlannedItem,
} from "./types";

/** Preset colours "1"–"6" (red, orange, yellow, green, cyan, purple). */
const PRESET_TO_NOTE: Record<string, NoteColorName> = {
  "1": "pink",
  "2": "orange",
  "3": "yellow",
  "4": "green",
  "5": "blue",
  "6": "purple",
};
const NOTE_TO_PRESET: Partial<Record<NoteColorName, string>> = {
  pink: "1",
  orange: "2",
  green: "4",
  blue: "5",
  purple: "6",
};

export interface JsonCanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  url?: string;
  label?: string;
}

export interface JsonCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromEnd?: "none" | "arrow";
  toEnd?: "none" | "arrow";
  label?: string;
}

export interface JsonCanvasFile {
  nodes: JsonCanvasNode[];
  edges: JsonCanvasEdge[];
}

function noteText(item: CanvasItem) {
  const content = item.content as NoteContent;
  if (content.plainText) return content.plainText;
  // Older notes keep HTML only; keep the words.
  return (content.text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LEFT_OUT_KIND: Partial<Record<ItemType, string>> = {
  [ItemType.DRAWING]: "free drawings",
  [ItemType.IMAGE]: "images",
  [ItemType.SHAPE]: "shapes",
  [ItemType.POLL]: "polls",
};

/**
 * A canvas as JSON Canvas 1.0, and what the format cannot hold (shown to the
 * person before the download).
 */
export function toJsonCanvas(items: readonly CanvasItem[]): {
  file: JsonCanvasFile;
  leftOut: Record<string, number>;
} {
  const leftOut: Record<string, number> = {};
  const nodes: JsonCanvasNode[] = [];
  const box = (item: CanvasItem) => ({
    id: item.id,
    x: Math.round(item.positionX),
    y: Math.round(item.positionY),
    width: Math.max(1, Math.round(item.width)),
    height: Math.max(1, Math.round(item.height)),
  });
  const ordered = [...items].sort(
    (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
  );
  const arrows: CanvasItem[] = [];
  for (const item of ordered) {
    switch (item.type) {
      case ItemType.NOTE: {
        const color = (item.content as NoteContent).color as
          NoteColorName | undefined;
        const preset = color ? NOTE_TO_PRESET[color] : undefined;
        nodes.push({
          ...box(item),
          type: "text",
          text: noteText(item),
          ...(preset ? { color: preset } : {}),
        });
        break;
      }
      case ItemType.TEXT:
        nodes.push({
          ...box(item),
          type: "text",
          text: (item.content as TextContent).text ?? "",
        });
        break;
      case ItemType.BOOKMARK:
      case ItemType.EMBED: {
        const url = (item.content as BookmarkContent).url;
        if (isWebUrl(url)) nodes.push({ ...box(item), type: "link", url });
        else bump(leftOut, "links without a web address");
        break;
      }
      case ItemType.FRAME: {
        const label = (item.content as FrameContent).title;
        nodes.push({
          ...box(item),
          type: "group",
          ...(label ? { label } : {}),
        });
        break;
      }
      case ItemType.ARROW:
        arrows.push(item);
        break;
      default:
        bump(leftOut, LEFT_OUT_KIND[item.type] ?? "other items");
    }
  }

  const exported = new Set(nodes.map((node) => node.id));
  const edges: JsonCanvasEdge[] = [];
  for (const arrow of arrows) {
    const content = arrow.content as ArrowContent;
    if (
      !content.startItemId ||
      !content.endItemId ||
      !exported.has(content.startItemId) ||
      !exported.has(content.endItemId)
    ) {
      bump(leftOut, "arrows not joining two items");
      continue;
    }
    edges.push({
      id: arrow.id,
      fromNode: content.startItemId,
      toNode: content.endItemId,
      ...(content.arrowHeadStart === "arrow" ? { fromEnd: "arrow" } : {}),
      ...(content.arrowHeadEnd === "none" ? { toEnd: "none" } : {}),
      ...(content.label ? { label: content.label } : {}),
    });
  }
  return { file: { nodes, edges }, leftOut };
}

const nodeSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.string().max(20),
    x: z.unknown(),
    y: z.unknown(),
    width: z.unknown(),
    height: z.unknown(),
    color: z.unknown().optional(),
    text: z.unknown().optional(),
    url: z.unknown().optional(),
    label: z.unknown().optional(),
  })
  .passthrough();

const edgeSchema = z
  .object({
    id: z.string().min(1).max(200),
    fromNode: z.string().min(1).max(200),
    toNode: z.string().min(1).max(200),
    fromEnd: z.unknown().optional(),
    toEnd: z.unknown().optional(),
    label: z.unknown().optional(),
  })
  .passthrough();

const fileSchema = z.object({
  nodes: z.array(z.unknown()).max(MAX_FILE_ELEMENTS).optional().default([]),
  edges: z.array(z.unknown()).max(MAX_FILE_ELEMENTS).optional().default([]),
});

/** True when parsed JSON looks like a JSON Canvas file. */
export function looksLikeJsonCanvas(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Array.isArray((value as { nodes?: unknown }).nodes) ||
      Array.isArray((value as { edges?: unknown }).edges)) &&
    !("elements" in (value as object))
  );
}

/** Plan the items of a parsed JSON Canvas file. Throws on a malformed file. */
export function planJsonCanvas(value: unknown): ImportPlan {
  const file = fileSchema.parse(value);
  const items: PlannedItem[] = [];
  const brought: Record<string, number> = {};
  const leftOut: Record<string, number> = {};
  const keys = new Set<string>();

  for (const raw of file.nodes) {
    const parsed = nodeSchema.safeParse(raw);
    if (!parsed.success || keys.has(parsed.data.id)) {
      bump(leftOut, "unreadable nodes");
      continue;
    }
    const node = parsed.data;
    const geometry = {
      key: node.id,
      positionX: coordinate(node.x),
      positionY: coordinate(node.y),
      width: size(node.width, 250),
      height: size(node.height, 60),
    };
    if (node.type === "text") {
      const text = cleanText(node.text, 20_000).trim();
      if (!text) {
        bump(leftOut, "empty text nodes");
        continue;
      }
      const color =
        typeof node.color === "string" ? PRESET_TO_NOTE[node.color] : undefined;
      items.push({
        ...geometry,
        type: ItemType.NOTE,
        content: {
          text: plainTextToNoteHtml(text),
          ...(color && (NOTE_COLOR_NAMES as readonly string[]).includes(color)
            ? { color }
            : {}),
        },
      });
      bump(brought, "notes");
    } else if (node.type === "link") {
      if (!isWebUrl(node.url)) {
        bump(leftOut, "links that are not web addresses");
        continue;
      }
      items.push({
        ...geometry,
        type: ItemType.BOOKMARK,
        content: { url: node.url, title: node.url },
      });
      bump(brought, "links");
    } else if (node.type === "group") {
      const label = cleanText(node.label, 200).trim();
      items.push({
        ...geometry,
        type: ItemType.FRAME,
        content: label ? { title: label } : {},
      });
      bump(brought, "groups");
    } else if (node.type === "file") {
      // A path on the author's disk: never followed.
      bump(leftOut, "files from the author's computer");
      continue;
    } else {
      bump(leftOut, "unknown nodes");
      continue;
    }
    keys.add(node.id);
  }

  for (const raw of file.edges) {
    const parsed = edgeSchema.safeParse(raw);
    if (
      !parsed.success ||
      !keys.has(parsed.data.fromNode) ||
      !keys.has(parsed.data.toNode) ||
      parsed.data.fromNode === parsed.data.toNode
    ) {
      bump(leftOut, "connections to missing nodes");
      continue;
    }
    const edge = parsed.data;
    const label = cleanText(edge.label, 100).trim();
    items.push({
      key: `edge:${edge.id}`,
      type: ItemType.ARROW,
      // Geometry is redrawn between the two items when written.
      positionX: 0,
      positionY: 0,
      width: 1,
      height: 1,
      startKey: edge.fromNode,
      endKey: edge.toNode,
      content: {
        arrowHeadStart: edge.fromEnd === "arrow" ? "arrow" : "none",
        arrowHeadEnd: edge.toEnd === "none" ? "none" : "arrow",
        strokeWidth: 2,
        ...(label ? { label } : {}),
      },
    });
    bump(brought, "connections");
  }
  return { items, brought, leftOut };
}
