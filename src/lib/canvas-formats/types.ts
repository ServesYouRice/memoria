/**
 * Open canvas file formats (IMP-096). Converters turn a file into a plan of
 * items, and the import route writes the plan. A file is untrusted: every
 * converter keeps plain text only, accepts `http`/`https` links only and
 * never follows a file path.
 */

import { type ItemType } from "@/types/canvas";

export const CANVAS_FILE_FORMATS = ["json-canvas", "excalidraw"] as const;
export type CanvasFileFormat = (typeof CANVAS_FILE_FORMATS)[number];

/** Largest canvas file accepted. */
export const MAX_CANVAS_FILE_BYTES = 10 * 1024 * 1024;
/** Most elements read from one file, before any limit on items. */
export const MAX_FILE_ELEMENTS = 10_000;

/** One item to create. `key` is the id the file gave it. */
export interface PlannedItem {
  key: string;
  type: ItemType;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  content: Record<string, unknown>;
  /** Arrows: the keys of the items their ends attach to. */
  startKey?: string;
  endKey?: string;
}

/** What a file held: brought in and left out, by plain-language kind. */
export interface ImportPlan {
  items: PlannedItem[];
  /** e.g. { notes: 3, links: 1 } */
  brought: Record<string, number>;
  /** e.g. { "embedded files": 2 } */
  leftOut: Record<string, number>;
}

export function bump(counts: Record<string, number>, kind: string, by = 1) {
  counts[kind] = (counts[kind] ?? 0) + by;
}

/** True for an absolute `http:` or `https:` URL. */
export function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** A finite number within ±1e7, else the fallback. */
export function coordinate(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(-1e7, Math.min(1e7, value))
    : fallback;
}

/** A positive size within limits. */
export function size(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.min(value, 1e5)
    : fallback;
}

/** Plain text as note HTML: escaped, one paragraph per line. */
export function plainTextToNoteHtml(text: string) {
  const escape = (line: string) =>
    line
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${escape(line)}</p>`)
    .join("");
}

/** Text that fits a stored string: no control characters, capped. */
export function cleanText(value: unknown, max: number) {
  if (typeof value !== "string") return "";

  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, max);
}
