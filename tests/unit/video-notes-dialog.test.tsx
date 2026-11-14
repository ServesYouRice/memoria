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
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/theme-context", () => ({
  useThemeMode: () => ({ mode: "light", toggleTheme: vi.fn() }),
}));

import { CanvasContextMenu } from "@/features/canvas/components/CanvasContextMenu";
import {
  TRANSCRIPT_FETCH_NOTICE,
  VideoNotesDialog,
  type VideoCardResponse,
} from "@/features/canvas/components/VideoNotesDialog";
import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function card(overrides: Partial<VideoCardResponse> = {}): VideoCardResponse {
  return {
    video: {
      url: VIDEO,
      provider: "youtube",
      source: "YouTube",
      host: "youtube.com",
      title: "A talk about quokkas",
    },
    notes: [
      {
        id: "n1",
        seconds: 65,
        text: "<img src=x onerror=alert(1)> key point",
        openUrl: `${VIDEO}&t=65s`,
        mine: true,
        createdAt: "2026-11-01T10:00:00.000Z",
      },
    ],
    transcript: {
      text: "0:05 <script>alert(1)</script> The quokka.",
      source: "pasted",
      language: null,
      updatedAt: "2026-11-02T10:00:00.000Z",
    },
    canEdit: true,
    autoFetch: { enabled: false, pending: false },
    limits: { maxNoteChars: 2000, maxTranscriptBytes: 262144 },
    ...overrides,
  };
}

function serve(body: VideoCardResponse) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      return new Response(null, { status: 201 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Video notes (IMP-114)", () => {
  it("shows the title, the source, and notes whose time opens the video there in a new tab", async () => {
    serve(card());
    render(<VideoNotesDialog itemId="item-1" onClose={() => {}} />);

    expect(await screen.findByText("A talk about quokkas")).toBeTruthy();
    expect(screen.getByText(/From YouTube · youtube\.com/)).toBeTruthy();
    const moment = screen.getByRole("link", {
      name: "Open the video at 1:05",
    });
    expect(moment.getAttribute("href")).toBe(`${VIDEO}&t=65s`);
    expect(moment.getAttribute("target")).toBe("_blank");
    expect(moment.getAttribute("rel")).toBe("noopener noreferrer");
    // Notes and the transcript are plain text, never markup.
    expect(document.querySelector("img")).toBeNull();
    const transcript = screen.getByTestId("video-transcript-text");
    expect(transcript.textContent).toBe(
      "0:05 <script>alert(1)</script> The quokka.",
    );
    expect(transcript.querySelector("script")).toBeNull();
    // Nothing from the video's site is loaded (DEC-011).
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByText(TRANSCRIPT_FETCH_NOTICE)).toBeNull();
  });

  it("adds a note at a typed time", async () => {
    const fetchMock = serve(card({ notes: [] }));
    render(<VideoNotesDialog itemId="item-1" onClose={() => {}} />);
    await screen.findByText("No notes yet.");

    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "1:02:03" },
    });
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "The turn" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note at a time" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/canvas-items/item-1/video/notes",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ seconds: 3723, text: "The turn" }),
        }),
      ),
    );
  });

  it("pastes a transcript", async () => {
    const fetchMock = serve(card({ transcript: null }));
    render(<VideoNotesDialog itemId="item-1" onClose={() => {}} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Paste transcript" }),
    );
    fireEvent.change(screen.getByLabelText("Transcript"), {
      target: { value: "Every word" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save transcript" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/canvas-items/item-1/video/transcript",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ text: "Every word" }),
        }),
      ),
    );
  });

  it("offers no changes to viewers, and says when captions are read automatically", async () => {
    serve(
      card({
        canEdit: false,
        transcript: null,
        autoFetch: { enabled: true, pending: true },
      }),
    );
    render(<VideoNotesDialog itemId="item-1" onClose={() => {}} />);
    expect(await screen.findByText(TRANSCRIPT_FETCH_NOTICE)).toBeTruthy();
    expect(TRANSCRIPT_FETCH_NOTICE).toMatch(/unofficial and can stop working/);
    expect(screen.getByText(/Reading the video's captions/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Paste transcript" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add note at a time" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete note at/ })).toBeNull();
  });
});

describe("the menu of a saved video offers its notes", () => {
  function renderMenu(item: CanvasItem) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CanvasContextMenu
          position={{ x: 10, y: 10, itemId: item.id }}
          capabilities={resolveCanvasCapabilities("VIEW")}
          onClose={() => {}}
          onDelete={() => {}}
          onDuplicate={() => {}}
          onCopy={() => {}}
          onComments={() => {}}
          item={item}
        />
      </QueryClientProvider>,
    );
  }

  const base = {
    canvasId: "cjld2cjxh0000qzrmn831i7rn",
    positionX: 0,
    positionY: 0,
    width: 300,
    height: 100,
    version: 1,
  };

  it("opens Video notes for a video link or link preview", async () => {
    const fetchMock = serve(card());
    renderMenu({
      ...base,
      id: "video-1",
      type: ItemType.EMBED,
      content: { url: VIDEO, embedType: "youtube" },
    } as unknown as CanvasItem);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Video notes and transcript…" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Video notes" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/canvas-items/video-1/video",
      expect.anything(),
    );
  });

  it("is not offered for other links", () => {
    serve(card());
    renderMenu({
      ...base,
      id: "link-1",
      type: ItemType.BOOKMARK,
      content: { url: "https://news.example/" },
    } as unknown as CanvasItem);
    expect(
      screen.queryByRole("menuitem", { name: "Video notes and transcript…" }),
    ).toBeNull();
  });
});
