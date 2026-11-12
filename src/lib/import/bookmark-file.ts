/**
 * Bookmark files people bring from elsewhere (IMP-091): the bookmarks HTML
 * file every browser and Raindrop export, and the CSV files from Pocket and
 * Raindrop. The file is untrusted. Only http(s) links are kept, titles and
 * tags are plain text cut to the item limits, and no HTML from the file is
 * ever rendered.
 */

import { load } from "cheerio";
import { z } from "zod";
import {
  MAX_BOOKMARK_TITLE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_ITEM,
} from "@/lib/constants";
import { ValidationError } from "@/lib/errors";

/** Largest file accepted. A browser export of 20,000 links is about 5 MB. */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
/** Most links one import may carry. */
export const MAX_IMPORT_LINKS = 20_000;
/** Longest link kept. */
export const MAX_IMPORT_URL_LENGTH = 2048;

export type BookmarkFileFormat = "html" | "csv";

export const importedLinkSchema = z.object({
  url: z
    .string()
    .max(MAX_IMPORT_URL_LENGTH)
    .url()
    .refine((value) => /^https?:\/\//i.test(value), {
      message: "Only http and https links can be imported.",
    }),
  title: z.string().max(MAX_BOOKMARK_TITLE_LENGTH),
  tags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_ITEM),
  /** The top-level folder the link sat in, or null. */
  folder: z.string().min(1).max(MAX_TAG_LENGTH).nullable(),
  /** When the link was first saved, as an ISO date, when the file says. */
  addedAt: z.string().datetime().nullable(),
});
export type ImportedLink = z.infer<typeof importedLinkSchema>;

export interface ParsedBookmarkFile {
  format: BookmarkFileFormat;
  links: ImportedLink[];
  /** Top-level folders, in the order they first appear. */
  folders: string[];
  /** Rows without a usable http(s) link, left out. */
  invalid: number;
}

function clean(text: string | undefined | null) {
  return (text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

function cleanTag(text: string) {
  return clean(text).replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH).trim();
}

function tagList(values: string[]) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const tag = cleanTag(value);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === MAX_TAGS_PER_ITEM) break;
  }
  return tags;
}

function dateFrom(raw: string | undefined | null): string | null {
  const value = clean(raw);
  if (!value) return null;
  const date = /^\d+$/.test(value)
    ? // Unix time; anything this long is in milliseconds.
      new Date(value.length > 11 ? Number(value) : Number(value) * 1000)
    : new Date(value);
  const time = date.getTime();
  // Ignore nonsense such as 0 or dates far in the future.
  if (!Number.isFinite(time) || time <= 0 || time > Date.now() + 86_400_000) {
    return null;
  }
  return date.toISOString();
}

interface RawLink {
  url: string;
  title: string;
  tags: string[];
  folders: string[];
  addedAt: string | null;
}

function toLink(raw: RawLink): ImportedLink | null {
  const folders = raw.folders.map(cleanTag).filter(Boolean);
  const candidate = {
    url: clean(raw.url),
    title: clean(raw.title).slice(0, MAX_BOOKMARK_TITLE_LENGTH),
    tags: tagList([...folders, ...raw.tags]),
    folder: folders[0] ?? null,
    addedAt: raw.addedAt,
  };
  const parsed = importedLinkSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function finish(
  format: BookmarkFileFormat,
  raws: RawLink[],
): ParsedBookmarkFile {
  if (raws.length > MAX_IMPORT_LINKS) {
    throw new ValidationError(
      `This file has more than ${MAX_IMPORT_LINKS.toLocaleString("en")} links. Split it into smaller files.`,
    );
  }
  const links: ImportedLink[] = [];
  const folders: string[] = [];
  let invalid = 0;
  for (const raw of raws) {
    const link = toLink(raw);
    if (!link) {
      invalid += 1;
      continue;
    }
    links.push(link);
    if (link.folder && !folders.includes(link.folder)) {
      folders.push(link.folder);
    }
  }
  return { format, links, folders, invalid };
}

/** The bookmarks HTML file (Netscape format) browsers and Raindrop export. */
export function parseBookmarksHtml(text: string): ParsedBookmarkFile {
  // Parsed as data only: no script runs and nothing from it is rendered.
  const $ = load(text);
  const raws: RawLink[] = [];
  $("a[href]").each((_, element) => {
    const anchor = $(element);
    // Each enclosing <DL> belongs to the folder heading just before it.
    const folders = anchor
      .parents("dl")
      .toArray()
      .reverse()
      .map((dl) => {
        const heading = $(dl).prevAll("h3").first();
        return heading.length > 0 ? heading.text() : "";
      })
      .filter((name) => clean(name) !== "");
    raws.push({
      url: anchor.attr("href") ?? "",
      title: anchor.text(),
      tags: (anchor.attr("tags") ?? "").split(","),
      folders,
      addedAt: dateFrom(anchor.attr("add_date")),
    });
  });
  return finish("html", raws);
}

/** RFC 4180 rows: quoted fields, doubled quotes, CRLF or LF line ends. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Column names each export uses, matched without regard to case. */
const COLUMNS = {
  url: ["url", "link", "href", "address"],
  title: ["title", "name"],
  tags: ["tags", "tag", "labels"],
  folder: ["folder", "collection"],
  addedAt: ["time_added", "created", "date_added", "added", "date"],
} as const;

/** Pocket and Raindrop CSV files: link, title, tags, folder and date. */
export function parseBookmarksCsv(text: string): ParsedBookmarkFile {
  const [header, ...rows] = csvRows(text.replace(/^﻿/, ""));
  const names = (header ?? []).map((name) => name.trim().toLowerCase());
  const column = (key: keyof typeof COLUMNS) =>
    names.findIndex((name) =>
      (COLUMNS[key] as readonly string[]).includes(name),
    );
  const at = {
    url: column("url"),
    title: column("title"),
    tags: column("tags"),
    folder: column("folder"),
    addedAt: column("addedAt"),
  };
  if (at.url < 0) {
    throw new ValidationError(
      "This CSV file has no link column (url or link).",
    );
  }
  const cell = (cells: string[], index: number) =>
    index < 0 ? "" : (cells[index] ?? "");
  const raws = rows.map((cells) => {
    const tags = cell(cells, at.tags);
    const folder = clean(cell(cells, at.folder));
    return {
      url: cell(cells, at.url),
      title: cell(cells, at.title),
      // Pocket separates tags with "|", Raindrop with ",".
      tags: tags.split(tags.includes("|") ? "|" : ","),
      // Raindrop writes nested folders as "Parent/Child".
      folders: folder ? folder.split("/") : [],
      addedAt: dateFrom(cell(cells, at.addedAt)),
    };
  });
  return finish("csv", raws);
}

/** Read an uploaded bookmark file of either format. */
export function parseBookmarkFile(
  text: string,
  fileName = "",
): ParsedBookmarkFile {
  const head = text.slice(0, 2048).toLowerCase();
  const looksHtml =
    /\.html?$/i.test(fileName) ||
    head.includes("<!doctype netscape-bookmark-file") ||
    head.includes("<dl") ||
    head.includes("<a href");
  return looksHtml ? parseBookmarksHtml(text) : parseBookmarksCsv(text);
}
