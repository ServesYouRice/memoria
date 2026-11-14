/**
 * IMP-113: a PDF on the canvas. Client-safe.
 *
 * Stored content: { assetId, filename, size, pageCount?, textStatus? }.
 * The file itself is a private upload of the same canvas, opened only in a
 * new tab (the browser's own viewer) or downloaded; it is never drawn inside
 * the app. `pageCount` and `textStatus` are written by the `pdf.read` job,
 * which keeps the PDF's text in the saved-text store (`ItemPageCopy`) for
 * search and Ask. The text is untrusted file content: it is shown as plain
 * text only and marked as data wherever AI reads it.
 */
import { z } from "zod";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";

export const PDF_CARD_WIDTH = 260;
export const PDF_CARD_HEIGHT = 132;

/** What the `pdf.read` job found. Absent while the text is being read. */
export const PDF_TEXT_STATUSES = [
  "ready",
  "partial",
  "no-text",
  "too-many-pages",
  "too-large",
  "over-budget",
  "unreadable",
] as const;
export type PdfTextStatus = (typeof PDF_TEXT_STATUSES)[number];

const UPLOAD_ID = /^c[a-z0-9]{20,63}$/i;

export const pdfContentSchema = z.object({
  assetId: z.string().regex(UPLOAD_ID, "Invalid upload id"),
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().min(0).max(RESOURCE_BUDGETS.pdf.maxFileBytes),
  pageCount: z.number().int().min(0).max(1_000_000).optional(),
  textStatus: z.enum(PDF_TEXT_STATUSES).optional(),
});

export interface PdfContent {
  assetId: string;
  filename: string;
  size: number;
  pageCount?: number;
  textStatus?: PdfTextStatus;
}

// The interface above is what the schema produces.
type SchemaMatches<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;
const schemaMatches: SchemaMatches<
  z.infer<typeof pdfContentSchema>,
  PdfContent
> = true;
void schemaMatches;

/** Type-scoped guard: use after checking `item.type === ItemType.PDF`. */
export function isPdfContentShape(value: unknown): value is PdfContent {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.assetId === "string" && typeof record.filename === "string"
  );
}

/** Where the file is read: the authorized upload route of its canvas. */
export function pdfFileUrl(
  assetId: string,
  options: { download?: boolean } = {},
): string {
  const path = `/api/v1/uploads/${encodeURIComponent(assetId)}`;
  return options.download ? `${path}?download=1` : path;
}

function megabytes(bytes: number) {
  const value = bytes / (1024 * 1024);
  return value >= 10 ? `${Math.round(value)} MB` : `${value.toFixed(1)} MB`;
}

/** "PDF · 12 pages · 2.4 MB" */
export function describePdfFile(content: PdfContent): string {
  const parts = ["PDF"];
  if (typeof content.pageCount === "number") {
    parts.push(
      content.pageCount === 1 ? "1 page" : `${content.pageCount} pages`,
    );
  }
  if (content.size > 0) parts.push(megabytes(content.size));
  return parts.join(" · ");
}

/** What happened to the text, in plain words. */
export function describePdfText(status: PdfTextStatus | undefined): string {
  const { maxPages, maxReadBytes } = RESOURCE_BUDGETS.pdf;
  switch (status) {
    case undefined:
      return "Reading the text…";
    case "ready":
      return "Its words show up in search and Ask.";
    case "partial":
      return "Only the first part of its text is searchable.";
    case "no-text":
      return "No readable text. Scanned pages are not read.";
    case "too-many-pages":
      return `Too many pages to read (over ${maxPages}). The file is kept.`;
    case "too-large":
      return `Too large to read (over ${megabytes(maxReadBytes)}). The file is kept.`;
    case "over-budget":
      return "Not searchable: your space for saved text is full.";
    case "unreadable":
      return "The text could not be read. The file is kept.";
  }
}
