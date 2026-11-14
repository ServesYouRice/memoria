import { describe, expect, it } from "vitest";
import {
  PDF_TEXT_STATUSES,
  describePdfFile,
  describePdfText,
  pdfFileUrl,
} from "@/lib/pdf/pdf-content";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { getItemPlainText, getItemTitle } from "@/lib/agents/item-text";
import { canvasItemSearchText } from "@/features/canvas/search";
import { ItemType, type CanvasItem } from "@/types/canvas";

const ASSET = "c" + "b".repeat(24);

describe("PDF card content (IMP-113)", () => {
  it("accepts a card naming an upload, and nothing else", () => {
    expect(
      parseCanvasItemContent(ItemType.PDF, {
        assetId: ASSET,
        filename: "report.pdf",
        size: 1024,
      }),
    ).toEqual({ assetId: ASSET, filename: "report.pdf", size: 1024 });
    for (const content of [
      { assetId: "../../etc/passwd", filename: "x.pdf", size: 1 },
      { assetId: ASSET, filename: "", size: 1 },
      { assetId: ASSET, filename: "x.pdf", size: 21 * 1024 * 1024 },
      { assetId: ASSET, filename: "x.pdf", size: 1, textStatus: "lies" },
      { url: "https://example.com/x.pdf", filename: "x.pdf" },
    ]) {
      expect(() => parseCanvasItemContent(ItemType.PDF, content)).toThrow();
    }
  });

  it("opens the file through the authorized upload route", () => {
    expect(pdfFileUrl(ASSET)).toBe(`/api/v1/uploads/${ASSET}`);
    expect(pdfFileUrl(ASSET, { download: true })).toBe(
      `/api/v1/uploads/${ASSET}?download=1`,
    );
  });

  it("describes the file and its text in plain words", () => {
    expect(
      describePdfFile({
        assetId: ASSET,
        filename: "a.pdf",
        size: 2.5 * 1024 * 1024,
        pageCount: 12,
      }),
    ).toBe("PDF · 12 pages · 2.5 MB");
    expect(describePdfText(undefined)).toBe("Reading the text…");
    expect(describePdfText("no-text")).toMatch(/No readable text/);
    expect(describePdfText("too-many-pages")).toMatch(
      /Too many pages to read \(over 300\)\. The file is kept\./,
    );
    expect(describePdfText("too-large")).toMatch(
      /Too large to read \(over 10 MB\)\. The file is kept\./,
    );
    for (const status of PDF_TEXT_STATUSES) {
      expect(describePdfText(status)).not.toBe("");
    }
  });

  it("gives search and agents its name, never the file's own text", () => {
    const content = {
      assetId: ASSET,
      filename: "Lease agreement.pdf",
      size: 10,
      textStatus: "ready",
    };
    expect(getItemTitle({ type: "PDF", content })).toBe("Lease agreement.pdf");
    expect(getItemPlainText({ type: "PDF", content })).toBe(
      "Lease agreement.pdf",
    );
    expect(
      canvasItemSearchText({
        type: ItemType.PDF,
        content,
        tags: ["contracts"],
      } as unknown as CanvasItem),
    ).toBe("contracts\nlease agreement.pdf");
  });
});
