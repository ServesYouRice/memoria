import type { NextRequest } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { boundRequestBody } from "@/lib/uploads/body-limit";
import {
  MAX_IMPORT_FILE_BYTES,
  parseBookmarkFile,
  type ParsedBookmarkFile,
} from "./bookmark-file";

/** Room for the form fields around the file. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

export const importOptionsSchema = z.object({
  destination: z.enum(["INBOX", "FOLDERS"]).default("INBOX"),
  enrich: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

/**
 * Read an uploaded bookmark file (IMP-091). The body is capped before it is
 * buffered, and the file must be UTF-8 text.
 */
export async function readBookmarkUpload(rawRequest: NextRequest): Promise<{
  form: FormData;
  fileName: string;
  parsed: ParsedBookmarkFile;
}> {
  const request = await boundRequestBody(
    rawRequest,
    MAX_IMPORT_FILE_BYTES + FORM_OVERHEAD_BYTES,
  );
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError("Send the bookmark file as a form upload.");
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    throw new ValidationError("Choose a bookmark file to import.");
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new ValidationError("This file is larger than 10 MB.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new ValidationError("This file is not a text file.");
  }
  const fileName = file instanceof File ? file.name : "bookmarks";
  return { form, fileName, parsed: parseBookmarkFile(text, fileName) };
}
