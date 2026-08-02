import { NextResponse } from "next/server";
import { generateText } from "@/lib/ai/service";
import { withAuthValidation } from "@/lib/api/route-handler";
import { generateSchema } from "@/lib/validation/ai";

export const POST = withAuthValidation(
  generateSchema,
  async ({ prompt, system, temperature }) => {
    const result = await generateText({ prompt, system, temperature });
    return NextResponse.json({ result });
  },
);
