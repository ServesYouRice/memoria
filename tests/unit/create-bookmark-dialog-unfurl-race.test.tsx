// @vitest-environment happy-dom
/**
 * TASK-223 — a preview that resolves after the URL changed is not stored, and
 * a bookmark is never saved with another URL's metadata.
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

const mutateAsync = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/use-canvas-items", () => ({
  useCreateCanvasItem: () => ({ mutateAsync }),
}));
vi.mock("@/lib/hooks/use-debounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

import { CreateBookmarkDialog } from "@/features/canvas/components/CreateBookmarkDialog";

const A = "https://example.com/a";
const B = "https://example.com/b";

type Pending = {
  url: string;
  signal?: AbortSignal;
  resolve: (title: string) => void;
};
const pending: Pending[] = [];
const fetchMock = vi.fn(
  (_input: string, init: { body: string; signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      const { url } = JSON.parse(init.body) as { url: string };
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
      pending.push({
        url,
        signal: init.signal,
        resolve: (title) =>
          resolve({ ok: true, json: async () => ({ title, siteName: title }) }),
      });
    }),
);

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
    });
  }
}

describe("CreateBookmarkDialog unfurl race (TASK-223)", () => {
  beforeEach(() => {
    pending.length = 0;
    fetchMock.mockClear();
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({});
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("drops A's late preview and saves B with B's metadata", async () => {
    render(
      <CreateBookmarkDialog open onClose={() => undefined} canvasId="c1" />,
    );
    const input = screen.getByRole("textbox", { name: /url/i });

    fireEvent.change(input, { target: { value: A } });
    await settle();
    expect(pending.map((p) => p.url)).toEqual([A]);

    fireEvent.change(input, { target: { value: B } });
    await settle();
    // A resolves late, after the field changed.
    pending[0].resolve("Title A");
    await settle();
    expect(screen.queryByText("Title A")).toBeNull();

    const forB = pending.find((p) => p.url === B);
    expect(forB).toBeDefined();
    forB!.resolve("Title B");
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /create bookmark/i }));
    await settle();
    expect(mutateAsync).toHaveBeenCalledOnce();
    const content = mutateAsync.mock.calls[0][0].content;
    expect(content.url).toBe(B);
    expect(content.title).toBe("Title B");
    expect(JSON.stringify(content)).not.toContain("Title A");
  });

  it("never submits metadata fetched for a different URL", async () => {
    render(
      <CreateBookmarkDialog open onClose={() => undefined} canvasId="c1" />,
    );
    const input = screen.getByRole("textbox", { name: /url/i });
    fireEvent.change(input, { target: { value: A } });
    await settle();
    fireEvent.change(input, { target: { value: B } });
    await settle();
    pending[0].resolve("Title A");
    await settle();

    // Submit before B's preview arrives.
    fireEvent.click(screen.getByRole("button", { name: /create bookmark/i }));
    await settle();
    expect(mutateAsync).toHaveBeenCalledOnce();
    const content = mutateAsync.mock.calls[0][0].content;
    expect(content.url).toBe(B);
    expect(JSON.stringify(content)).not.toContain("Title A");
  });
});
