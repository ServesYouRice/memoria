"use client";

/**
 * IMP-113: put a PDF on the canvas. The file is uploaded as a private PDF
 * (the server recognises it from its first bytes and refuses anything that
 * only claims to be one), then a PDF card naming it is created like any
 * other item; the server reads its text in the background.
 */

import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";
import {
  PDF_CARD_HEIGHT,
  PDF_CARD_WIDTH,
  type PdfContent,
} from "@/lib/pdf/pdf-content";
import { ItemType } from "@/types/canvas";
import type { CreateCanvasItemInput } from "@/lib/validation/canvas-item";

const MAX_MB = Math.round(RESOURCE_BUDGETS.pdf.maxFileBytes / (1024 * 1024));

/** A hint for routing a dropped file; the server decides what it is. */
export function looksLikePdf(file: { name: string; type: string }): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

async function uploadError(response: Response): Promise<string> {
  if (response.status === 413) {
    return `This PDF is larger than ${MAX_MB} MB, the most Memoria keeps.`;
  }
  const body = (await response.json().catch(() => null)) as {
    detail?: string;
    error?: string;
  } | null;
  const detail = body?.detail || body?.error;
  if (detail === "This file is not a PDF") {
    return "This file is not a PDF, so it was not added.";
  }
  return detail || "The PDF could not be uploaded.";
}

/** Upload one PDF to the canvas; returns the card content naming it. */
export async function uploadPdf(
  canvasId: string,
  file: File,
): Promise<PdfContent> {
  if (file.size > RESOURCE_BUDGETS.pdf.maxFileBytes) {
    throw new Error(
      `This PDF is larger than ${MAX_MB} MB, the most Memoria keeps.`,
    );
  }
  const form = new FormData();
  form.append("canvasId", canvasId);
  form.append("purpose", "pdf");
  form.append("file", file);
  const response = await fetch("/api/v1/upload?purpose=pdf", {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error(await uploadError(response));
  const data = (await response.json()) as {
    assetId: string;
    filename: string;
    size: number;
  };
  return {
    assetId: data.assetId,
    filename: (data.filename || file.name || "Document.pdf").slice(0, 255),
    size: data.size,
  };
}

/** The create input for a PDF card centred on `at` (world coordinates). */
export function pdfCardInput(
  canvasId: string,
  content: PdfContent,
  at: { x: number; y: number },
  zIndex: number,
): CreateCanvasItemInput {
  return {
    canvasId,
    type: ItemType.PDF,
    positionX: at.x - PDF_CARD_WIDTH / 2,
    positionY: at.y - PDF_CARD_HEIGHT / 2,
    width: PDF_CARD_WIDTH,
    height: PDF_CARD_HEIGHT,
    zIndex,
    content,
    tags: [],
  };
}
