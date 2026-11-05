// @vitest-environment happy-dom

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { CanvasContextMenu } from "@/features/canvas/components/CanvasContextMenu";
import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";

const canvasId = "cjld2cjxh0000qzrmn831i7rn";
const frame = {
  id: "cjld2cjxh0001qzrmn831i7rn",
  canvasId,
  type: ItemType.FRAME,
  positionX: 0,
  positionY: 0,
  width: 400,
  height: 300,
  content: { title: "Pile" },
  version: 1,
} as unknown as CanvasItem;
const note = { ...frame, id: "note-1", type: ItemType.NOTE } as CanvasItem;

const fetchMock = vi.fn();

function mockAi(configured: boolean) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/ai/provider") {
      return new Response(JSON.stringify({ availability: { configured } }), {
        status: 200,
      });
    }
    if (url === "/api/v1/ai/summarize/pile" && init?.method === "POST") {
      return new Response(JSON.stringify({ item: { id: "n" } }), {
        status: 201,
      });
    }
    return new Response("{}", { status: 404 });
  });
}

function renderMenu(item: CanvasItem, role: "OWNER" | "VIEW" = "OWNER") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CanvasContextMenu
        position={{ x: 10, y: 10, itemId: item.id }}
        capabilities={resolveCanvasCapabilities(role)}
        onClose={() => {}}
        onDelete={() => {}}
        onDuplicate={() => {}}
        onCopy={() => {}}
        onComments={() => {}}
        canvasId={canvasId}
        item={item}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("frame AI menu (IMP-069)", () => {
  it("offers summary, checklist and table on a frame when AI is configured", async () => {
    mockAi(true);
    renderMenu(frame);
    expect(await screen.findByText("Summarize pile into a note")).toBeTruthy();
    expect(screen.getByText("Turn pile into a checklist")).toBeTruthy();
    expect(screen.getByText("Compare pile in a table")).toBeTruthy();
  });

  it("is hidden when AI is not configured", async () => {
    mockAi(false);
    renderMenu(frame);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/v1/ai/provider"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Summarize pile into a note")).toBeNull();
  });

  it("is not offered on other item types or to viewers", async () => {
    mockAi(true);
    renderMenu(note);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Summarize pile into a note")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    cleanup();

    fetchMock.mockClear();
    renderMenu(frame, "VIEW");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Summarize pile into a note")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the chosen kind for the frame", async () => {
    mockAi(true);
    renderMenu(frame);
    fireEvent.click(await screen.findByText("Turn pile into a checklist"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(
      ([url]) => url === "/api/v1/ai/summarize/pile",
    )!;
    expect(JSON.parse(call[1].body)).toEqual({
      canvasId,
      frameId: frame.id,
      kind: "checklist",
    });
  });
});
