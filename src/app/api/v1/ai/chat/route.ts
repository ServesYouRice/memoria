import { NextResponse } from "next/server";
import { generateText } from "@/lib/ai/service";
import { withAuthValidation } from "@/lib/api/route-handler";
import { chatSchema } from "@/lib/validation/ai";
import { PERSONAS, type PersonaKey } from "@/lib/ai/personas";

export const POST = withAuthValidation(
  chatSchema,
  async ({ message, context, persona }) => {
    const personaDef = PERSONAS[persona as PersonaKey];
    // Add instruction to be concise and helpful
    const systemPrompt = `${personaDef.systemPrompt}\n\nUser Context:\n${context || "No specific context provided."}\n\nKeep responses concise and relevant to the canvas context.`;

    const result = await generateText({
      prompt: message,
      system: systemPrompt,
    });

    return NextResponse.json({ result });
  },
);
