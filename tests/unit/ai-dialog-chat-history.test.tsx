// @vitest-environment happy-dom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIDialog } from "@/features/canvas/components/AIDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AIDialog chat", () => {
  it("sends earlier turns with a follow-up message", async () => {
    const answers = ["Teal", "Navy"];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ result: answers.shift() })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AIDialog open onClose={vi.fn()} canvasId="c1" onAddNote={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Chat/ }));

    const send = async (text: string) => {
      fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
        target: { value: text },
      });
      fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), {
        key: "Enter",
      });
    };
    await send("Name a colour");
    await screen.findByText("Teal");
    await send("A darker one?");
    await screen.findByText("Navy");

    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call as unknown as [string, RequestInit])[1].body)),
    );
    expect(bodies[0].history).toBeUndefined();
    expect(bodies[1]).toMatchObject({
      message: "A darker one?",
      history: [
        { role: "user", content: "Name a colour" },
        { role: "assistant", content: "Teal" },
      ],
    });
  });
});
