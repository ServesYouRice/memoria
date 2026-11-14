// @vitest-environment happy-dom

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));

import { CanvasContextMenu } from "@/features/canvas/components/CanvasContextMenu";
import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";
import {
  SavedCopyDialog,
  savedCopyDate,
  type SavedCopyResponse,
} from "@/features/canvas/components/SavedCopyDialog";

function answer(body: SavedCopyResponse) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => body })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Read saved copy (IMP-094)", () => {
  it("shows the page text as plain text and when the copy was made", async () => {
    answer({
      url: "https://news.example/story",
      copy: {
        text: "<img src=x onerror=alert(1)> The story.",
        readAt: "2026-11-01T10:00:00.000Z",
        archiveUrl: "https://web.archive.org/web/1/https://news.example/story",
      },
    });
    render(<SavedCopyDialog itemId="item-1" onClose={() => {}} />);

    const text = await screen.findByTestId("saved-copy-text");
    expect(text.textContent).toBe("<img src=x onerror=alert(1)> The story.");
    expect(text.querySelector("img")).toBeNull();
    expect(
      screen.getByText(
        new RegExp(`made on ${savedCopyDate("2026-11-01T10:00:00.000Z")}`),
      ),
    ).toBeTruthy();
    const archive = screen.getByRole("link", {
      name: "Open the web-archive copy",
    });
    expect(archive.getAttribute("href")).toBe(
      "https://web.archive.org/web/1/https://news.example/story",
    );
    expect(archive.getAttribute("rel")).toBe("noopener noreferrer");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/canvas-items/item-1/page-copy",
      expect.anything(),
    );
  });

  it("shows the picture and PDF of the page when the deployment keeps them (IMP-110)", async () => {
    answer({
      url: "https://news.example/story",
      copy: null,
      capture: {
        capturedAt: "2026-11-14T10:00:00.000Z",
        imageUrl: "/api/v1/canvas-items/item-1/page-capture/image",
        pdfUrl: "/api/v1/canvas-items/item-1/page-capture/pdf",
      },
    });
    render(<SavedCopyDialog itemId="item-1" onClose={() => {}} />);

    const capture = await screen.findByTestId("saved-copy-capture");
    const picture = capture.querySelector("img");
    expect(picture?.getAttribute("src")).toBe(
      "/api/v1/canvas-items/item-1/page-capture/image",
    );
    const pdf = screen.getByRole("link", { name: "Open the PDF" });
    expect(pdf.getAttribute("href")).toBe(
      "/api/v1/canvas-items/item-1/page-capture/pdf",
    );
    expect(pdf.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      screen.getByText(
        new RegExp(`made on ${savedCopyDate("2026-11-14T10:00:00.000Z")}`),
      ),
    ).toBeTruthy();
    // A capture counts as a saved copy: no "no saved copy yet" message.
    expect(screen.queryByText(/no saved copy yet/)).toBeNull();
  });

  it("shows nothing extra without a capture", async () => {
    answer({
      url: "https://news.example/story",
      copy: { text: "The story.", readAt: null, archiveUrl: null },
    });
    render(<SavedCopyDialog itemId="item-1" onClose={() => {}} />);
    await screen.findByTestId("saved-copy-text");
    expect(screen.queryByTestId("saved-copy-capture")).toBeNull();
  });

  it("explains when there is no copy yet and an archive lookup is running", async () => {
    answer({ url: "https://news.example/", copy: null, archivePending: true });
    render(<SavedCopyDialog itemId="item-1" onClose={() => {}} />);
    expect(await screen.findByText(/no saved copy yet/)).toBeTruthy();
    expect(screen.getByText(/Looking for a web-archive copy/)).toBeTruthy();
  });
});

describe("the bookmark menu offers the saved copy", () => {
  it("opens Read saved copy for a link, even for a viewer", async () => {
    answer({ url: "https://news.example/", copy: null });
    const bookmark = {
      id: "link-1",
      canvasId: "cjld2cjxh0000qzrmn831i7rn",
      type: ItemType.BOOKMARK,
      positionX: 0,
      positionY: 0,
      width: 300,
      height: 100,
      content: { url: "https://news.example/", title: "News" },
      version: 1,
    } as unknown as CanvasItem;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CanvasContextMenu
          position={{ x: 10, y: 10, itemId: bookmark.id }}
          capabilities={resolveCanvasCapabilities("VIEW")}
          onClose={() => {}}
          onDelete={() => {}}
          onDuplicate={() => {}}
          onCopy={() => {}}
          onComments={() => {}}
          item={bookmark}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Read saved copy" }));
    expect(
      await screen.findByRole("dialog", { name: "Saved copy" }),
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/canvas-items/link-1/page-copy",
      expect.anything(),
    );
  });
});
