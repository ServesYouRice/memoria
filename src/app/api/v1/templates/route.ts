import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { requireTemplatesEnabled } from "@/lib/templates/availability";
import {
  BUILT_IN_TEMPLATES,
  TEMPLATE_CATEGORY_LABELS,
  summarizeTemplate,
} from "@/lib/templates/built-in";

/** IMP-098 — the built-in templates "New canvas" offers. */
export const GET = withApiHandler(async () => {
  await requireAuth();
  requireTemplatesEnabled();
  return NextResponse.json({
    templates: BUILT_IN_TEMPLATES.map(summarizeTemplate),
    categories: TEMPLATE_CATEGORY_LABELS,
  });
});
