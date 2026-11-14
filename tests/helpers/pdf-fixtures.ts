import { jsPDF } from "jspdf";

/** A real PDF with one page per entry; an empty string leaves a page blank. */
export function pdfBytes(pages: string[]): Buffer {
  const doc = new jsPDF();
  pages.forEach((text, index) => {
    if (index > 0) doc.addPage();
    if (text) doc.text(text, 10, 20);
    // A page with no text still draws something, like a scanned page would.
    else doc.rect(10, 10, 50, 50, "F");
  });
  return Buffer.from(doc.output("arraybuffer"));
}
