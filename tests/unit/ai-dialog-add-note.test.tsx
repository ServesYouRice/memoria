// @vitest-environment happy-dom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIDialog } from "@/features/canvas/components/AIDialog";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ result: "Generated idea" })),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function generate(onAddNote: (text: string) => void | Promise<void>) {
  const onClose = vi.fn();
  render(
    <AIDialog open onClose={onClose} canvasId="c1" onAddNote={onAddNote} />,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "an idea" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Generate$/ }));
  await screen.findByText("Generated idea");
  return onClose;
}

describe("AIDialog Add as Note", () => {
  it("keeps the result and shows an error when the note is not created", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const onClose = await generate(() =>
        Promise.reject(new Error("create failed")),
      );
      fireEvent.click(screen.getByRole("button", { name: "Add as Note" }));
      expect(
        await screen.findByText("Failed to add the note. Please try again."),
      ).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Generated idea")).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("closes once the note exists and disables the button while adding", async () => {
    let finish!: () => void;
    const onAddNote = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const onClose = await generate(onAddNote);
    const add = screen.getByRole("button", { name: "Add as Note" });
    fireEvent.click(add);
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(true));
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onAddNote).toHaveBeenCalledWith("Generated idea");
  });
});
