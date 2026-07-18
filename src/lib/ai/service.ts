import OpenAI from "openai";
import { ServiceUnavailableError } from "@/lib/errors";

function getOpenAIClient() {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey || apiKey === "dummy-key") {
    throw new ServiceUnavailableError(
      "AI features are not configured. Set OPENAI_API_KEY to enable them.",
    );
  }
  return new OpenAI({ apiKey });
}

export interface GenerateOptions {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function generateText(options: GenerateOptions): Promise<string> {
  const openai = getOpenAIClient();
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            options.system ||
            "You are a helpful assistant for a collaborative canvas application.",
        },
        { role: "user", content: options.prompt },
      ],
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 500,
    });

    return response.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("AI Generation Error:", error);
    throw new Error("Failed to generate text");
  }
}

export async function summarizeCanvas(items: any[]): Promise<string> {
  const content = items
    .slice(0, 1000)
    .map((item) => {
      if (item.type === "NOTE") return `Note: ${item.content?.text || ""}`;
      if (item.type === "TEXT") return `Text: ${item.content?.text || ""}`;
      if (item.type === "BOOKMARK")
        return `Bookmark: ${item.content?.title || item.content?.url}`;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 100_000);

  if (!content) return "Canvas is empty.";

  return generateText({
    prompt: `Summarize the following canvas content into a concise paragraph:\n\n${content}`,
    system:
      "You are a succinct summarizer. Focus on the main themes and key information.",
    temperature: 0.3,
  });
}

export async function generateTags(content: string): Promise<string[]> {
  const result = await generateText({
    prompt: `Generate up to 5 relevant tags for the following content. Return them as a comma-separated list, no hashmarks:\n\n${content}`,
    system:
      "You are a precise tagging system. Output only the tags separated by commas.",
    temperature: 0.3,
  });

  return result
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
