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
import { SerendipityDialog } from "@/features/canvas/components/SerendipityDialog";

const found = {
  results: [
    {
      item: { id: "i1", type: "NOTE", content: { text: "old idea" } },
      reason: "Shared tag",
      similarityScore: 0.8,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(found))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function scan(onAddItems: (items: unknown[]) => Promise<void>) {
  const onClose = vi.fn();
  render(
    <SerendipityDialog
      open
      onClose={onClose}
      canvasId="c1"
      onAddItems={onAddItems}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Surprise Me" }));
  await screen.findByText("Found 1 connections:");
  return onClose;
}

describe("SerendipityDialog add", () => {
  it("keeps the results and shows an error when adding fails", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const onAddItems = vi.fn(() => Promise.reject(new Error("Save failed")));
      const onClose = await scan(onAddItems);
      fireEvent.click(screen.getByRole("button", { name: "Add" }));

      expect(await screen.findByText("Save failed")).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Found 1 connections:")).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("closes once the item is added and disables Add while pending", async () => {
    let finish!: () => void;
    const onAddItems = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const onClose = await scan(onAddItems);
    const add = screen.getByRole("button", { name: "Add" });
    fireEvent.click(add);
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(add);
    expect(onAddItems).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
