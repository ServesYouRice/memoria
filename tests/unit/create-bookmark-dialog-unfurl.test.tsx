// @vitest-environment happy-dom
/**
 * TASK-065 — a failed preview for an unchanged URL is not retried in a loop.
 */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useCreateCanvasItem: () => ({ mutateAsync: vi.fn() }),
}));
// No debounce delay: the effect sees each value immediately.
vi.mock("@/lib/hooks/use-debounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

import { CreateBookmarkDialog } from "@/features/canvas/components/CreateBookmarkDialog";

const fetchMock = vi.fn();

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

describe("CreateBookmarkDialog unfurl failures (TASK-065)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        ok: false,
        json: async () => ({ error: "Bookmark unfurling is disabled" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks once per URL after a failure, and again for a new URL", async () => {
    render(
      <CreateBookmarkDialog open onClose={() => undefined} canvasId="c1" />,
    );
    const input = screen.getByRole("textbox", { name: /url/i });

    fireEvent.change(input, { target: { value: "https://example.com/a" } });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Bookmark unfurling is disabled"),
    ).toBeTruthy();

    fireEvent.change(input, { target: { value: "https://example.com/b" } });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      url: "https://example.com/b",
    });
  });
});
