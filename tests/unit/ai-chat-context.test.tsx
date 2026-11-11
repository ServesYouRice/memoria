// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIDialog } from "@/features/canvas/components/AIDialog";
import * as validation from "@/lib/validation/ai";

const { chatSchema } = validation;
const MAX =
  ((validation as Record<string, unknown>).CHAT_CONTEXT_MAX_CHARS as
    number | undefined) ?? 8_000;
const bound = (validation as Record<string, unknown>).boundChatContext as
  ((text: string, max?: number) => string) | undefined;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function chat(getContext: () => string, response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AIDialog
      open
      onClose={vi.fn()}
      canvasId="c1"
      onAddNote={vi.fn()}
      getContext={getContext}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: /Chat/ }));
  fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
    target: { value: "What links these?" },
  });
  fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), {
    key: "Enter",
  });
  return fetchMock;
}

describe("chat context bound", () => {
  it("keeps context at, below and above the limit within chatSchema", () => {
    expect(bound).toBeTypeOf("function");
    const small = "a short note";
    expect(bound!(small)).toBe(small);
    const exact = "x".repeat(MAX);
    expect(bound!(exact)).toBe(exact);
    const big = "word ".repeat(MAX);
    const cut = bound!(big);
    expect(cut.length).toBeLessThanOrEqual(MAX);
    expect(cut).toMatch(/truncated/);
    expect(
      chatSchema.safeParse({ message: "Hi", persona: "creative", context: cut })
        .success,
    ).toBe(true);
  });

  it("sends a context the schema accepts for a canvas with lots of notes", async () => {
    const fetchMock = await chat(
      () => "A long note. ".repeat(2_000),
      new Response(JSON.stringify({ result: "Answer" })),
    );
    await screen.findByText("Answer");
    const body = JSON.parse(
      String(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body,
      ),
    );
    expect(body.context.length).toBeLessThanOrEqual(MAX);
    expect(chatSchema.safeParse(body).success).toBe(true);
  });

  it("says when the server rejects the request as invalid", async () => {
    await chat(
      () => "short",
      new Response(JSON.stringify({ title: "Validation Error" }), {
        status: 400,
      }),
    );
    expect(await screen.findByText(/too large or invalid/)).toBeTruthy();
  });
});
