import { NextResponse } from "next/server";
import { generateTags } from "@/lib/ai/service";
import { withAuthValidation } from "@/lib/api/route-handler";
import { tagSchema } from "@/lib/validation/ai";

export const POST = withAuthValidation(tagSchema, async ({ content }) => {
  const tags = await generateTags(content);
  return NextResponse.json({ tags });
});
