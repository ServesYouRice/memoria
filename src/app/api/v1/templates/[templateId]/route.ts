import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { NotFoundError } from "@/lib/errors";
import { requireTemplatesEnabled } from "@/lib/templates/availability";
import {
  findBuiltInTemplate,
  summarizeTemplate,
} from "@/lib/templates/built-in";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

const paramsSchema = z.object({ templateId: z.string().min(1).max(64) });

/** IMP-098 — one built-in template, as the gallery shows it. */
export const GET = withApiHandler(
  async (_request: Request, { params }: RouteContext) => {
    await requireAuth();
    requireTemplatesEnabled();
    const { templateId } = paramsSchema.parse(await params);
    const template = findBuiltInTemplate(templateId);
    if (!template) throw new NotFoundError("Template not found.");
    return NextResponse.json({ template: summarizeTemplate(template) });
  },
);
