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

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import {
  HomeBoardSuggestions,
  describeReasons,
  isInboxBoardName,
} from "@/features/canvas/components/HomeBoardSuggestions";
import { ItemType, type CanvasItem } from "@/types/canvas";

const canvasId = "cjld2cjxh0000qzrmn831i7rn";
const item = {
  id: "item-1",
  canvasId,
  type: ItemType.BOOKMARK,
  positionX: 100,
  positionY: 100,
  width: 360,
  height: 120,
  content: { url: "https://example.com", title: "Colosseum tickets" },
  version: 1,
} as unknown as CanvasItem;

const fetchMock = vi.fn();

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function renderInbox() {
  return render(
    <HomeBoardSuggestions
      canvasId={canvasId}
      items={[item]}
      zoom={1}
      position={{ x: 0, y: 0 }}
      stageSize={{ width: 1200, height: 800 }}
    />,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/home-boards")) {
      return json({
        suggestions: [
          {
            itemId: "item-1",
            boardId: "c-rome",
            boardName: "Rome trip",
            confidence: 0.7,
            reasons: ["board-name"],
          },
        ],
        recentlyFiled: [],
      });
    }
    if (url.endsWith("/home-board") && init?.method === "POST") {
      return json({ boardName: "Rome trip", changeSetId: "cs-1" });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomeBoardSuggestions", () => {
  it("only runs on an Inbox board", () => {
    expect(isInboxBoardName(" inbox ")).toBe(true);
    expect(isInboxBoardName("Rome trip")).toBe(false);
    expect(describeReasons(["tags"])).toMatch(/these tags/);
  });

  it("shows the suggested board under the item and accepts it", async () => {
    renderInbox();
    expect(await screen.findByText("Rome trip")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Accept: move to Rome trip" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/items/item-1/home-board",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "accept" }),
        }),
      ),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Filed in Rome trip.",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Undo" }),
        }),
      ),
    );

    // The toast's Undo reverts the move.
    const [, options] = toast.success.mock.calls[0]!;
    options.action.onClick();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/items/item-1/home-board",
        expect.objectContaining({ body: JSON.stringify({ action: "undo" }) }),
      ),
    );
  });

  it("dismisses a suggestion", async () => {
    renderInbox();
    fireEvent.click(
      await screen.findByRole("button", { name: "Dismiss suggestion" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("home-board-suggestion")).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/items/item-1/home-board",
      expect.objectContaining({ body: JSON.stringify({ action: "dismiss" }) }),
    );
  });
});
