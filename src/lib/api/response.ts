import { NextResponse } from "next/server";
import type { z } from "zod";
import { InternalServerError } from "@/lib/errors";

export function validatedJson<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  init?: ResponseInit,
): NextResponse<z.infer<T>> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new InternalServerError("Server response did not match its contract");
  }
  return NextResponse.json(parsed.data, init);
}
