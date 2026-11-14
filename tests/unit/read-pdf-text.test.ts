import { describe, expect, it } from "vitest";
import { readPdfText, PDF_READ_LIMITS } from "@/lib/pdf/read-pdf-text";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";
import { pdfBytes } from "../helpers/pdf-fixtures";

describe("readPdfText (IMP-113)", () => {
  it("reads the words of every page and counts the pages", async () => {
    const result = await readPdfText(
      pdfBytes(["Quarterly zebra report", "", "Platypus appendix"]),
    );
    expect(result).toMatchObject({
      status: "text",
      pageCount: 3,
      truncated: false,
    });
    if (result.status !== "text") throw new Error("expected text");
    expect(result.text).toContain("Quarterly zebra report");
    expect(result.text).toContain("Platypus appendix");
  });

  it("says when a PDF has no readable text (scanned pages are not read)", async () => {
    await expect(readPdfText(pdfBytes(["", ""]))).resolves.toEqual({
      status: "no-text",
      pageCount: 2,
    });
  });

  it("does not read a PDF with more pages than the limit", async () => {
    await expect(
      readPdfText(pdfBytes(["one", "two", "three"]), {
        limits: { maxPages: 2 },
      }),
    ).resolves.toEqual({ status: "too-many-pages", pageCount: 3 });
  });

  it("does not read a file over the reading size limit", async () => {
    const bytes = pdfBytes(["big"]);
    await expect(
      readPdfText(bytes, { limits: { maxReadBytes: bytes.length - 1 } }),
    ).resolves.toEqual({ status: "too-large" });
  });

  it("keeps at most the text budget and says it was cut", async () => {
    const result = await readPdfText(
      pdfBytes(["alpha beta gamma delta", "epsilon zeta eta theta"]),
      { limits: { maxTextBytes: 12 } },
    );
    expect(result).toMatchObject({ status: "text", truncated: true });
    if (result.status !== "text") throw new Error("expected text");
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(12);
  });

  it("reports a damaged file as unreadable", async () => {
    const bytes = Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.from("not really a pdf ".repeat(20)),
    ]);
    await expect(readPdfText(bytes)).resolves.toEqual({
      status: "unreadable",
      reason: "damaged",
    });
  });

  it("stops the reader at the time limit", async () => {
    await expect(
      readPdfText(pdfBytes(["slow"]), { limits: { timeoutMs: 1 } }),
    ).resolves.toEqual({ status: "unreadable", reason: "timed-out" });
  });

  it("stops the reader when the job is cancelled", async () => {
    const controller = new AbortController();
    const reading = readPdfText(pdfBytes(["cancel me"]), {
      signal: controller.signal,
    });
    controller.abort(new Error("lease lost"));
    await expect(reading).rejects.toThrow("lease lost");
  });

  it("uses the limits written in the resource budgets", () => {
    expect(PDF_READ_LIMITS).toEqual({
      maxReadBytes: RESOURCE_BUDGETS.pdf.maxReadBytes,
      maxPages: RESOURCE_BUDGETS.pdf.maxPages,
      maxTextBytes: RESOURCE_BUDGETS.pdf.maxTextBytesPerFile,
      timeoutMs: RESOURCE_BUDGETS.pdf.readTimeoutMs,
      heapMb: RESOURCE_BUDGETS.pdf.readHeapMb,
    });
    expect(RESOURCE_BUDGETS.pdf.maxReadBytes).toBeLessThanOrEqual(
      RESOURCE_BUDGETS.pdf.maxFileBytes,
    );
  });
});
